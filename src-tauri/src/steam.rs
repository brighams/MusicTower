use keyvalues_parser::{Obj, Value, Vdf};
use std::fs;
use std::path::{Path, PathBuf};

pub struct SteamApp {
    pub appid: String,
    pub name: String,
    pub installdir: String,
    pub install_path: Option<String>,
    pub hq_audio: Option<String>,
    pub library_image: String,
    pub header_image: String,
    pub capsule_image: String,
    pub capsule_imagev5: String,
    pub steam_details: String,
    pub steam_store_page: String,
    pub steam_app_run: String,
    pub steam_app_friends_play: String,
    pub steam_app_workshop: String,
    pub steam_app_details: String,
    pub steam_app_screenshots: String,
    pub steam_app_validate: String,
}

pub struct OwnedApp {
    pub appid: String,
    pub name: String,
    pub playtime_forever: String,
    pub img_icon_url: String,
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

#[cfg(windows)]
fn steam_dir_from_registry() -> Option<PathBuf> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey("Software\\Valve\\Steam").ok()?;
    let path: String = key.get_value("SteamPath").ok()?;
    Some(PathBuf::from(path))
}

pub fn find_steam_dir(config_override: Option<&str>) -> Option<PathBuf> {
    if let Some(dir) = config_override {
        let p = PathBuf::from(dir);
        if p.join("steamapps").exists() {
            return Some(p);
        }
    }

    #[cfg(windows)]
    if let Some(p) = steam_dir_from_registry() {
        if p.join("steamapps").exists() {
            return Some(p);
        }
    }

    if let Some(home) = std::env::var("HOME").ok().or_else(|| std::env::var("USERPROFILE").ok()) {
        let candidates = [
            format!("{home}/.local/share/Steam"),
            format!("{home}/.steam/steam"),
            format!("{home}/.steam/Steam"),
            format!("{home}/Library/Application Support/Steam"),
        ];
        for candidate in &candidates {
            let p = PathBuf::from(candidate);
            if p.join("steamapps").exists() {
                return Some(p);
            }
        }
    }
    None
}

fn steam_library_paths(steam_dir: &Path) -> Vec<PathBuf> {
    let vdf_path = steam_dir.join("steamapps").join("libraryfolders.vdf");
    let content = match fs::read_to_string(&vdf_path) {
        Ok(c) => c,
        Err(_) => return vec![steam_dir.to_path_buf()],
    };
    let vdf = match Vdf::parse(&content) {
        Ok(v) => v,
        Err(_) => return vec![steam_dir.to_path_buf()],
    };
    let root_obj = match &vdf.value {
        Value::Obj(o) => o,
        _ => return vec![steam_dir.to_path_buf()],
    };
    let mut paths: Vec<PathBuf> = root_obj
        .iter()
        .flat_map(|(_k, vals)| vals)
        .filter_map(|v| match v {
            Value::Obj(o) => vdf_str(o, "path"),
            _ => None,
        })
        .map(PathBuf::from)
        .collect();
    if paths.is_empty() {
        paths.push(steam_dir.to_path_buf());
    }
    paths
}

pub fn steam_scan_roots(steam_dir: &Path) -> Vec<String> {
    let mut roots = Vec::new();
    for lib in steam_library_paths(steam_dir) {
        let steamapps = lib.join("steamapps");
        roots.push(steamapps.join("music").to_string_lossy().into_owned());
        roots.push(steamapps.join("common").to_string_lossy().into_owned());
    }
    roots
}

pub fn load_steam_libraries(steam_dir: &Path) -> Result<Vec<SteamApp>, Box<dyn std::error::Error>> {
    let vdf_path = steam_dir.join("steamapps").join("libraryfolders.vdf");
    let content = fs::read_to_string(&vdf_path)?;
    let vdf = Vdf::parse(&content)?;

    let root_obj = match &vdf.value {
        Value::Obj(o) => o,
        _ => return Err("libraryfolders.vdf: expected root object".into()),
    };

    let mut apps = Vec::new();

    for (_idx, folder_vals) in root_obj.iter() {
        for folder_val in folder_vals {
            let folder = match folder_val {
                Value::Obj(o) => o,
                _ => continue,
            };

            let lib_path = match vdf_str(folder, "path") {
                Some(p) => p,
                None => continue,
            };

            let steamapps = PathBuf::from(&lib_path).join("steamapps");
            if !steamapps.exists() {
                continue;
            }

            let common = steamapps.join("common");
            let music = steamapps.join("music");

            let app_ids: Vec<String> = match vdf_obj(folder, "apps") {
                Some(apps_obj) => apps_obj.keys().map(|k| k.as_ref().to_owned()).collect(),
                None => continue,
            };

            println!("STEAM: Library {} — {} apps", lib_path, app_ids.len());

            for app_id in &app_ids {
                let manifest_path = steamapps.join(format!("appmanifest_{app_id}.acf"));
                if !manifest_path.exists() {
                    eprintln!("STEAM: missing manifest for appid {app_id}");
                    continue;
                }

                let manifest_content = match fs::read_to_string(&manifest_path) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("STEAM: failed to read manifest {app_id}: {e}");
                        continue;
                    }
                };

                let manifest_vdf = match Vdf::parse(&manifest_content) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("STEAM: failed to parse manifest {app_id}: {e}");
                        continue;
                    }
                };

                let app_state = match &manifest_vdf.value {
                    Value::Obj(o) => o,
                    _ => continue,
                };

                let name = match vdf_str(app_state, "name") {
                    Some(n) => n,
                    None => continue,
                };
                let installdir = match vdf_str(app_state, "installdir") {
                    Some(d) => d,
                    None => continue,
                };

                let hq_audio = app_state
                    .get("UserConfig")
                    .and_then(|vals| vals.first())
                    .and_then(|v| match v {
                        Value::Obj(uc) => vdf_str(uc, "highqualityaudio"),
                        _ => None,
                    });

                let music_path = music.join(&installdir);
                let common_path = common.join(&installdir);
                let install_path = if music_path.exists() {
                    Some(music_path.to_string_lossy().into_owned())
                } else if common_path.exists() {
                    Some(common_path.to_string_lossy().into_owned())
                } else {
                    None
                };

                let cdn = format!(
                    "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/{app_id}"
                );

                apps.push(SteamApp {
                    appid: app_id.clone(),
                    name,
                    installdir,
                    install_path,
                    hq_audio,
                    library_image: format!("{cdn}/library_600x900.jpg"),
                    header_image: format!("{cdn}/header.jpg"),
                    capsule_image: format!("{cdn}/capsule_231x87.jpg"),
                    capsule_imagev5: format!("{cdn}/capsule_184x69.jpg"),
                    steam_details: format!(
                        "https://store.steampowered.com/api/appdetails/?appids={app_id}"
                    ),
                    steam_store_page: format!("https://store.steampowered.com/app/{app_id}"),
                    steam_app_run: format!("steam://rungameid/{app_id}"),
                    steam_app_friends_play: format!(
                        "steam://url/CommunityFriendsThatPlay/{app_id}"
                    ),
                    steam_app_workshop: format!("steam://url/SteamWorkshopPage/{app_id}"),
                    steam_app_details: format!("steam://nav/games/details/{app_id}"),
                    steam_app_screenshots: format!("steam://open/screenshots/{app_id}"),
                    steam_app_validate: format!("steam://validate/{app_id}"),
                });
            }
        }
    }

    println!("STEAM: Loaded {} installed apps total", apps.len());
    Ok(apps)
}

pub fn owned_apps() -> Result<Vec<OwnedApp>, Box<dyn std::error::Error>> {
    let api_key = std::env::var("STEAM_API_KEY").unwrap_or_else(|_| {
        eprintln!("ERROR: STEAM_API_KEY environment variable is not set");
        std::process::exit(3);
    });
    let steam_id = std::env::var("STEAM_ID").unwrap_or_else(|_| {
        eprintln!("ERROR: STEAM_ID environment variable is not set");
        std::process::exit(3);
    });

    let url = format!(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/\
         ?key={api_key}&steamid={steam_id}&format=json\
         &include_appinfo=1&include_played_free_games=1&include_free_sub=1"
    );

    println!("STEAM: Fetching owned games...");
    let response: serde_json::Value = ureq::get(&url).call()?.into_json()?;

    let games = response["response"]["games"]
        .as_array()
        .ok_or("Steam API: no games array in response")?;

    let owned: Vec<OwnedApp> = games
        .iter()
        .map(|g| OwnedApp {
            appid: g["appid"].as_u64().unwrap_or(0).to_string(),
            name: g["name"].as_str().unwrap_or("").to_owned(),
            playtime_forever: g["playtime_forever"].as_u64().unwrap_or(0).to_string(),
            img_icon_url: g["img_icon_url"].as_str().unwrap_or("").to_owned(),
        })
        .collect();

    println!("STEAM: Found {} owned apps", owned.len());
    Ok(owned)
}
