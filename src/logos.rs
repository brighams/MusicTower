use keyvalues_parser::{Obj, Value, Vdf};
use rusqlite::{params, Connection};
use steam_vent::{Connection as SteamConn, ConnectionTrait, ServerList};
use steam_vent_proto_steam::steammessages_clientserver_appinfo::{
    cmsg_client_picsproduct_info_request, CMsgClientPICSProductInfoRequest,
    CMsgClientPICSProductInfoResponse,
};
use std::time::Duration;

const BATCH_SIZE: i64 = 200;
const CDN_BASE: &str = "https://steamcdn-a.akamaihd.net/steam/apps";

pub fn spawn_logo_loader(player_db: String, _cache_dir: String) {
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("LOGOS: failed to create runtime: {e}");
                return;
            }
        };
        rt.block_on(async {
            if let Err(e) = run_logo_loader(&player_db).await {
                eprintln!("LOGOS: loader error: {e}");
            }
        });
    });
}

async fn run_logo_loader(
    player_db: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let conn = Connection::open(player_db)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;

    let server_list = ServerList::discover().await?;
    let steam = SteamConn::anonymous(&server_list).await?;
    println!("LOGOS: Steam connection established");

    loop {
        let appids: Vec<u32> = {
            let mut stmt = conn.prepare(
                "SELECT appid FROM logo_cache WHERE updated_date IS NULL AND error IS NULL LIMIT ?1",
            )?;
            let rows: Vec<String> = stmt
                .query_map([BATCH_SIZE], |r| r.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect();
            rows.into_iter().filter_map(|s| s.parse::<u32>().ok()).collect()
        };

        if appids.is_empty() {
            println!("LOGOS: all apps processed");
            break;
        }

        println!("LOGOS: fetching {} appids", appids.len());

        let msg = CMsgClientPICSProductInfoRequest {
            apps: appids
                .iter()
                .map(|&id| cmsg_client_picsproduct_info_request::AppInfo {
                    appid: Some(id),
                    only_public_obsolete: Some(true),
                    ..Default::default()
                })
                .collect(),
            meta_data_only: Some(false),
            single_response: Some(true),
            ..Default::default()
        };

        let now = unix_now();

        let resp: CMsgClientPICSProductInfoResponse = match steam.job(msg).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("LOGOS: PICS request failed: {e}");
                for appid in &appids {
                    conn.execute(
                        "UPDATE logo_cache SET error=?, updated_date=? WHERE appid=?",
                        params![format!("appid={appid}: PICS request failed: {e}"), now, appid.to_string()],
                    )
                    .ok();
                }
                continue;
            }
        };

        let responded: std::collections::HashSet<u32> =
            resp.apps.iter().map(|a| a.appid()).collect();

        for appid in &appids {
            if !responded.contains(appid) {
                println!("LOGOS: appid={appid}: not in PICS response");
                conn.execute(
                    "UPDATE logo_cache SET error=?, updated_date=? WHERE appid=?",
                    params![format!("appid={appid}: not in PICS response"), now, appid.to_string()],
                )
                .ok();
            }
        }

        for app_info in &resp.apps {
            let appid = app_info.appid();
            let buffer = app_info.buffer();

            let (capsule_url, hero_url, logo_url, error) = match parse_urls(appid, buffer) {
                Ok(urls) => (urls.0, urls.1, urls.2, None::<String>),
                Err(e) => {
                    println!("LOGOS: appid={appid}: parse error: {e}");
                    (None, None, None, Some(format!("appid={appid}: {e}")))
                }
            };

            if let Err(e) = conn.execute(
                "UPDATE logo_cache SET capsule_url=?, hero_url=?, logo_url=?, error=?, updated_date=? WHERE appid=?",
                params![capsule_url, hero_url, logo_url, error, now, appid.to_string()],
            ) {
                println!("LOGOS: appid={appid}: db update error: {e}");
            }
        }

        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    Ok(())
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn parse_urls(
    appid: u32,
    buffer: &[u8],
) -> Result<(Option<String>, Option<String>, Option<String>), Box<dyn std::error::Error>> {
    let text = std::str::from_utf8(buffer)?;
    let text = text.trim().trim_matches('\0');
    if text.is_empty() {
        return Ok((None, None, None));
    }

    let parsed = Vdf::parse(text)?;
    let root = match &parsed.value {
        Value::Obj(o) => o,
        _ => return Ok((None, None, None)),
    };

    let common = match vdf_obj(root, "common") {
        Some(c) => c,
        None => return Ok((None, None, None)),
    };

    let assets = vdf_obj(common, "library_assets_full")
        .or_else(|| vdf_obj(common, "library_assets"));

    let assets = match assets {
        Some(a) => a,
        None => return Ok((None, None, None)),
    };

    Ok((
        pick_asset(appid, assets, "library_capsule"),
        pick_asset(appid, assets, "library_hero"),
        pick_asset(appid, assets, "library_logo"),
    ))
}

fn pick_asset(appid: u32, assets: &Obj, kind: &str) -> Option<String> {
    let node = vdf_obj(assets, kind)?;
    let variant = vdf_obj(node, "image")?;
    let hash = vdf_str(variant, "english").or_else(|| {
        variant
            .iter()
            .flat_map(|(_, vals)| vals)
            .find_map(|v| match v {
                Value::Str(s) => Some(s.as_ref().to_owned()),
                _ => None,
            })
    })?;
    if hash.len() < 10 {
        return None;
    }
    Some(format!("{CDN_BASE}/{appid}/{hash}"))
}

fn vdf_str(obj: &Obj, key: &str) -> Option<String> {
    obj.get(key)
        .and_then(|vals| vals.first())
        .and_then(|v| match v {
            Value::Str(s) => Some(s.as_ref().to_owned()),
            _ => None,
        })
}

fn vdf_obj<'a>(obj: &'a Obj<'a>, key: &str) -> Option<&'a Obj<'a>> {
    obj.get(key)
        .and_then(|vals| vals.first())
        .and_then(|v| match v {
            Value::Obj(o) => Some(o),
            _ => None,
        })
}
