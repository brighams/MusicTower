mod config;
mod database;
mod scanner;
mod server;
mod setup;
mod steam;

use std::env;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Instant;

const DEFAULT_CONFIG: &str = "config/scanner_conf.yaml";

fn open_browser(url: &str) {
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd").args(["/c", "start", "", url]).spawn();
}

#[tokio::main]
async fn main() {
    setup::load_dotenv();

    let start = Instant::now();

    let args: Vec<String> = env::args().skip(1).collect();

    let config_path = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .cloned()
        .unwrap_or_else(|| DEFAULT_CONFIG.to_owned());

    let serve_bind: String = if args.iter().any(|a| a == "--no-serve") {
        String::new()
    } else {
        args.iter().find_map(|a| {
            if a == "--serve" {
                Some("127.0.0.1:8086".to_owned())
            } else {
                a.strip_prefix("--serve=").map(|s| s.to_owned())
            }
        }).unwrap_or_else(|| "127.0.0.1:8086".to_owned())
    };

    let scanning = Arc::new(AtomicBool::new(true));

    if env::var("STEAM_ID").is_err() || env::var("STEAM_API_KEY").is_err() {
        println!("SETUP: STEAM_ID or STEAM_API_KEY not set — starting first-time setup");
        let creds = setup::run_setup().await;
        env::set_var("STEAM_ID", &creds.steam_id);
        env::set_var("STEAM_API_KEY", &creds.api_key);
    }

    let mut cfg = config::load_config(&config_path);

    println!("STEAM SCANNER: config loaded from {config_path}");

    let player_db = cfg.player_db_path();
    let steam_details_db = cfg.steam_details_db_path();

    let mut conn = database::backup_and_init(&cfg.db_file).unwrap_or_else(|e| {
        eprintln!("ERROR: failed to init database: {e}");
        std::process::exit(1);
    });

    match steam::find_steam_dir(cfg.steam_dir.as_deref()) {
        Some(steam_dir) => {
            println!("STEAM: install dir: {steam_dir:?}");
            for root in steam::steam_scan_roots(&steam_dir) {
                if !cfg.scan_roots.contains(&root) {
                    cfg.scan_roots.push(root);
                }
            }
            match steam::load_steam_libraries(&steam_dir) {
                Ok(apps) => {
                    if let Err(e) = database::insert_steam_apps(&mut conn, &apps) {
                        eprintln!("DB: failed to insert steam apps: {e}");
                    }
                }
                Err(e) => eprintln!("STEAM: failed to load libraries: {e}"),
            }
        }
        None => eprintln!("STEAM: could not locate Steam installation, skipping library scan"),
    }

    match steam::owned_apps() {
        Ok(owned) => {
            if let Err(e) = database::insert_owned_apps(&mut conn, &owned) {
                eprintln!("DB: failed to insert owned apps: {e}");
            }
            match database::open_player_db(&steam_details_db) {
                Ok(pconn) => {
                    if let Err(e) = database::sync_owned_to_player_db(&pconn, &owned) {
                        eprintln!("DB: failed to sync to steam_details.db: {e}");
                    }
                }
                Err(e) => eprintln!("DB: failed to open steam_details.db: {e}"),
            }
        }
        Err(e) => eprintln!("STEAM: skipping owned games ({e})"),
    }

    let extensions = cfg.extensions();

    let server_handle = if !serve_bind.is_empty() {
        let shared_db: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>> = database::make_placeholder_db();
        let db_for_server = shared_db.clone();
        let scan_flag = scanning.clone();
        let bind = serve_bind.clone();
        let ext = extensions.clone();
        let handle = tokio::spawn(async move {
            server::start(&bind, db_for_server, scan_flag, ext).await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        open_browser(&format!("https://{serve_bind}"));
        Some((handle, shared_db))
    } else {
        None
    };

    println!(
        "SCANNER: scanning for {:?} in {} roots",
        extensions,
        cfg.scan_roots.len()
    );

    let files = scanner::scan_all(&cfg.scan_roots, &extensions);
    println!("SCANNER: found {} files", files.len());

    if let Err(e) = database::insert_steam_files(&mut conn, &files) {
        eprintln!("DB: failed to insert steam files: {e}");
    }

    drop(conn);

    if let Err(e) = database::init_player_db(&player_db) {
        eprintln!("DB: failed to init player.db: {e}");
    }

    println!(
        "STEAM SCANNER: scan done in {:.3}s",
        start.elapsed().as_secs_f64()
    );

    if let Some((handle, shared_db)) = server_handle {
        match database::open_server_db(&cfg.db_file, &player_db) {
            Ok(conn) => { *shared_db.lock().unwrap() = conn; }
            Err(e) => eprintln!("DB: failed to open server db: {e}"),
        }
        scanning.store(false, Ordering::Relaxed);
        handle.await.ok();
    }
}
