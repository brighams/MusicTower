#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod database;
mod scanner;
mod server;
mod setup;
mod steam;

use std::env;
use std::time::Instant;
use tracing::{error, info};

const DEFAULT_CONFIG: &str = "config/scanner_conf.yaml";
const BIND_ADDR: &str = "127.0.0.1:8086";

fn main() {
    let log_file = tracing_appender::rolling::never(".", "music_server.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(log_file);
    tracing_subscriber::fmt()
        .with_writer(non_blocking)
        .with_ansi(false)
        .init();

    tauri::Builder::default()
        .setup(|_app| {
            tauri::async_runtime::spawn(init_and_serve());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn init_and_serve() {
    setup::load_dotenv();

    let start = Instant::now();

    if env::var("STEAM_ID").is_err() || env::var("STEAM_API_KEY").is_err() {
        info!("SETUP: STEAM_ID or STEAM_API_KEY not set — starting first-time setup");
        let creds = setup::run_setup().await;
        env::set_var("STEAM_ID", &creds.steam_id);
        env::set_var("STEAM_API_KEY", &creds.api_key);
    }

    let mut cfg = config::load_config(DEFAULT_CONFIG);
    info!("STEAM SCANNER: config loaded from {DEFAULT_CONFIG}");

    let player_db = database::player_db_path(&cfg.db_file);

    let mut conn = match database::backup_and_init(&cfg.db_file) {
        Ok(c) => c,
        Err(e) => {
            error!("ERROR: failed to init database: {e}");
            return;
        }
    };

    let db_file = cfg.db_file.clone();
    let extensions = cfg.extensions();

    // Start the server immediately so the UI is available while the scan runs.
    tauri::async_runtime::spawn(server::start(
        BIND_ADDR,
        db_file,
        player_db.clone(),
        extensions.clone(),
    ));

    match steam::find_steam_dir(cfg.steam_dir.as_deref()) {
        Some(steam_dir) => {
            info!("STEAM: install dir: {steam_dir:?}");
            for root in steam::steam_scan_roots(&steam_dir) {
                if !cfg.scan_roots.contains(&root) {
                    cfg.scan_roots.push(root);
                }
            }
            match steam::load_steam_libraries(&steam_dir) {
                Ok(apps) => {
                    if let Err(e) = database::insert_steam_apps(&mut conn, &apps) {
                        error!("DB: failed to insert steam apps: {e}");
                    }
                }
                Err(e) => error!("STEAM: failed to load libraries: {e}"),
            }
        }
        None => error!("STEAM: could not locate Steam installation, skipping library scan"),
    }

    match steam::owned_apps() {
        Ok(owned) => {
            if let Err(e) = database::insert_owned_apps(&mut conn, &owned) {
                error!("DB: failed to insert owned apps: {e}");
            }
            match database::open_player_db(&player_db) {
                Ok(pconn) => {
                    if let Err(e) = database::sync_owned_to_player_db(&pconn, &owned) {
                        error!("DB: failed to sync to player.db: {e}");
                    }
                }
                Err(e) => error!("DB: failed to open player.db: {e}"),
            }
        }
        Err(e) => error!("STEAM: skipping owned games ({e})"),
    }

    info!(
        "SCANNER: scanning for {:?} in {} roots",
        extensions,
        cfg.scan_roots.len()
    );

    let files = scanner::scan_all(&cfg.scan_roots, &extensions);
    info!("SCANNER: found {} files", files.len());

    if let Err(e) = database::insert_steam_files(&mut conn, &files) {
        error!("DB: failed to insert steam files: {e}");
    }

    drop(conn);

    info!(
        "STEAM SCANNER: scan done in {:.3}s",
        start.elapsed().as_secs_f64()
    );
}
