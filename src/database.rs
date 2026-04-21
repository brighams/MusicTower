use crate::steam::{OwnedApp, SteamApp};
use regex::Regex;
use rusqlite::{params, Connection, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

pub fn make_placeholder_db() -> Arc<std::sync::Mutex<Connection>> {
    let conn = Connection::open_in_memory().expect("in-memory placeholder db");
    Arc::new(std::sync::Mutex::new(conn))
}

pub fn open_server_db(db_path: &str, player_db: &str) -> Result<Connection, Box<dyn std::error::Error>> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
    let escaped = player_db.replace('\'', "''");
    conn.execute_batch(&format!("ATTACH DATABASE '{escaped}' AS pdb;"))
        .unwrap_or_else(|e| eprintln!("WARNING: failed to attach player.db: {e}"));
    Ok(conn)
}

pub fn backup_and_init(db_path: &str) -> Result<Connection, Box<dyn std::error::Error>> {
    let path = Path::new(db_path);

    if path.exists() {
        let dir = path.parent().unwrap_or(Path::new("."));
        let name = path.file_name().unwrap().to_string_lossy();
        let mut n = 1u32;
        loop {
            let backup = dir.join(format!("_{n:04}_{name}"));
            if !backup.exists() {
                fs::rename(path, &backup)?;
                println!("DB: Backed up existing DB to {backup:?}");
                break;
            }
            n += 1;
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "PRAGMA synchronous = OFF;
         PRAGMA journal_mode = MEMORY;
         PRAGMA temp_store = MEMORY;
         PRAGMA locking_mode = EXCLUSIVE;",
    )?;
    create_schema(&conn)?;
    println!("DB: Initialized at {db_path}");
    Ok(conn)
}

fn create_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE steam_apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            appid TEXT NOT NULL,
            name TEXT NOT NULL,
            installdir TEXT NOT NULL,
            install_path TEXT,
            hq_audio TEXT,
            library_image TEXT NOT NULL,
            header_image TEXT NOT NULL,
            capsule_image TEXT NOT NULL,
            capsule_imagev5 TEXT NOT NULL,
            steam_details TEXT NOT NULL,
            steam_store_page TEXT NOT NULL,
            steam_app_run TEXT NOT NULL,
            steam_app_friends_play TEXT NOT NULL,
            steam_app_workshop TEXT NOT NULL,
            steam_app_details TEXT NOT NULL,
            steam_app_screenshots TEXT NOT NULL,
            steam_app_validate TEXT NOT NULL
        );
        CREATE TABLE steam_owned_apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            appid TEXT NOT NULL,
            name TEXT NOT NULL,
            playtime_forever TEXT NOT NULL,
            img_icon_url TEXT NOT NULL
        );
        CREATE TABLE steam_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_type TEXT NOT NULL,
            appid TEXT,
            scan_type TEXT NOT NULL,
            title TEXT NOT NULL,
            dir_path TEXT NOT NULL,
            full_path TEXT NOT NULL UNIQUE,
            file_name TEXT NOT NULL,
            size INTEGER NOT NULL,
            modified INTEGER NOT NULL,
            created INTEGER NOT NULL,
            join_key TEXT,
            album_key TEXT,
            media_class TEXT,
            lang TEXT
        );
        CREATE INDEX idx_steam_apps_appid ON steam_apps (appid);
        CREATE INDEX idx_steam_apps_name ON steam_apps (name);
        CREATE INDEX idx_steam_apps_installdir ON steam_apps (installdir);
        CREATE INDEX idx_steam_owned_apps_name ON steam_owned_apps (name);
        CREATE INDEX idx_steam_files_media_type ON steam_files (media_type);
        CREATE INDEX idx_steam_files_title ON steam_files (title);
        CREATE INDEX idx_steam_files_file_name ON steam_files (file_name);
        CREATE INDEX idx_steam_files_appid ON steam_files (appid);
        CREATE INDEX idx_steam_files_join_key ON steam_files (join_key);
        CREATE INDEX idx_steam_files_album_key ON steam_files (album_key);
        CREATE INDEX idx_steam_files_media_class ON steam_files (media_class);",
    )
}

pub fn insert_steam_apps(conn: &mut Connection, apps: &[SteamApp]) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO steam_apps VALUES (
                NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
            )",
        )?;
        for app in apps {
            stmt.execute(params![
                app.appid,
                app.name,
                app.installdir,
                app.install_path,
                app.hq_audio,
                app.library_image,
                app.header_image,
                app.capsule_image,
                app.capsule_imagev5,
                app.steam_details,
                app.steam_store_page,
                app.steam_app_run,
                app.steam_app_friends_play,
                app.steam_app_workshop,
                app.steam_app_details,
                app.steam_app_screenshots,
                app.steam_app_validate,
            ])?;
        }
    }
    tx.commit()?;
    println!("DB: Inserted {} steam apps", apps.len());
    Ok(())
}

pub fn insert_owned_apps(conn: &mut Connection, apps: &[OwnedApp]) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt =
            tx.prepare("INSERT INTO steam_owned_apps VALUES (NULL,?,?,?,?)")?;
        for app in apps {
            stmt.execute(params![
                app.appid,
                app.name,
                app.playtime_forever,
                app.img_icon_url,
            ])?;
        }
    }
    tx.commit()?;
    println!("DB: Inserted {} owned apps", apps.len());
    Ok(())
}

pub fn insert_steam_files(conn: &mut Connection, files: &[(PathBuf, String)]) -> Result<()> {
    let title_re =
        Regex::new(r"(?i)(?:common|music)/([^/\\]+)|workshop/content/\d+/([^/\\]+)").unwrap();

    let mut owned_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT name, appid FROM steam_owned_apps")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (name, appid) = row?;
            owned_map.insert(name.to_lowercase(), appid);
        }
    }

    let mut apps_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT installdir, name, appid FROM steam_apps")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            let (installdir, name, appid) = row?;
            apps_map.entry(installdir.to_lowercase()).or_insert(appid.clone());
            apps_map.entry(name.to_lowercase()).or_insert(appid);
        }
    }

    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO steam_files VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )?;

        for (i, (path, scan_root)) in files.iter().enumerate() {
            let path_str = path.to_string_lossy();

            let title = title_re
                .captures(&path_str)
                .and_then(|c| c.get(1).or_else(|| c.get(2)))
                .map(|m| m.as_str().to_owned())
                .unwrap_or_else(|| "Unknown".to_owned());

            let media_type = path
                .extension()
                .map(|e| e.to_string_lossy().to_uppercase())
                .unwrap_or_else(|| "UNKNOWN".into());

            let dir_path = path
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();

            let file_name = path
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_default();

            let title_lower = title.to_lowercase();
            let appid = owned_map.get(&title_lower)
                .or_else(|| apps_map.get(&title_lower))
                .cloned();

            let appid_str = appid.as_deref().unwrap_or("0");
            let join_key = format!("{appid_str}-{title}-{file_name}");
            let album_key = format!("{appid_str}-{title}");

            let norm_root = scan_root.trim_end_matches(['/', '\\']).replace('\\', "/");
            let scan_type = if norm_root.ends_with("steamapps/music") {
                "music"
            } else {
                "files"
            };

            let meta = fs::metadata(path).ok();
            let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            let modified = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .map(millis_since_epoch)
                .unwrap_or(0);
            let created = meta
                .as_ref()
                .and_then(|m| m.created().ok())
                .map(millis_since_epoch)
                .unwrap_or(0);

            let (media_class, lang) = classify_media(&path_str);

            stmt.execute(params![
                media_type.as_str(),
                appid,
                scan_type,
                title,
                dir_path,
                path_str.as_ref(),
                file_name,
                size,
                modified,
                created,
                join_key,
                album_key,
                media_class,
                lang,
            ])?;

            if (i + 1) % 10_000 == 0 {
                println!("DB: {} files inserted...", i + 1);
            }
        }
    }
    tx.commit()?;
    println!("DB: Inserted {} total files", files.len());
    Ok(())
}

fn classify_media(path_str: &str) -> (String, Option<String>) {
    let lower = path_str.to_lowercase();

    if lower.contains("audiobook") || lower.contains("audio book") {
        return ("audiobook".to_owned(), None);
    }

    let is_effect = lower.contains("effects")
        || lower.contains("soundeffects")
        || lower.contains("/sfx/")
        || lower.contains("/fx/");

    if is_effect {
        return ("effect".to_owned(), None);
    }

    const LANG_CODES: &[&str] = &[
        "en", "de", "fr", "es", "sv", "pt", "nl", "it",
        "zh", "cs", "hr", "pl", "ro", "ru", "sk", "tr",
    ];

    for code in LANG_CODES {
        if lower.contains(&format!("/{code}/")) || lower.contains(&format!("_{code}/")) {
            return ("voice".to_owned(), Some(code.to_string()));
        }
    }

    let is_voice = lower.contains("voice")
        || lower.contains("localization")
        || lower.contains("localized")
        || lower.contains("locale")
        || lower.contains("language")
        || lower.contains("speech");

    if is_voice {
        return ("voice".to_owned(), None);
    }

    ("music".to_owned(), None)
}

fn millis_since_epoch(t: SystemTime) -> i64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn init_player_db(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS track_stats (
             join_key  TEXT PRIMARY KEY,
             rating    INTEGER NOT NULL DEFAULT 0,
             play_count INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS album_stats (
             album_key TEXT PRIMARY KEY,
             rating    INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS logo_cache (
             appid        TEXT PRIMARY KEY,
             error        TEXT,
             capsule_url  TEXT,
             hero_url     TEXT,
             logo_url     TEXT,
             updated_date INTEGER
         );",
    )?;
    println!("DB: player.db initialized at {path}");
    Ok(())
}

pub fn open_player_db(path: &str) -> Result<Connection, Box<dyn std::error::Error>> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS steam_app_details (
             appid            TEXT PRIMARY KEY,
             title            TEXT NOT NULL,
             date_updated     TEXT,
             error            INTEGER,
             parent_id        TEXT,
             file_path        TEXT,
             type             TEXT,
             is_free          INTEGER,
             short_description TEXT,
             header_image     TEXT,
             capsule_image    TEXT,
             capsule_imagev5  TEXT,
             website          TEXT,
             publisher        TEXT,
             developer        TEXT
         );",
    )?;
    println!("DB: steam_details.db opened at {path}");
    Ok(conn)
}

pub fn sync_owned_to_player_db(conn: &Connection, apps: &[OwnedApp]) -> Result<()> {
    let mut stmt =
        conn.prepare("INSERT OR IGNORE INTO steam_app_details (appid, title) VALUES (?,?)")?;
    for app in apps {
        stmt.execute(params![app.appid, app.name])?;
    }
    println!("DB: Synced {} owned apps to steam_details.db", apps.len());
    Ok(())
}

pub fn insert_logo_cache_placeholders(conn: &mut Connection, appids: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare("INSERT OR IGNORE INTO logo_cache (appid) VALUES (?1)")?;
        for appid in appids {
            stmt.execute([appid])?;
        }
    }
    tx.commit()?;
    println!("LOGOS: Inserted {} logo_cache placeholder rows", appids.len());
    Ok(())
}
