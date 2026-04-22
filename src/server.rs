const INDEX_HTML: &str = include_str!("index.html");
const LOADING_HTML: &str = include_str!("loading.html");
const COLORS_JS: &str = include_str!("colors.js");
const LOGO_SVG: &str = include_str!("logo.svg");
const STYLES_CSS: &str = include_str!("styles.css");
const IMG_COALESCE_JS: &str = include_str!("ImgCoalesce.js");
const VISUALIZER_JS: &str = include_str!("visualizer.js");
const VERTEXSHADERVIS_JS: &str = include_str!("VSA_shadercore.js");
const MIXER_JS: &str = include_str!("mixer.js");
const MIXER_CSS: &str = include_str!("mixer.css");
const MIXER_PNG: &[u8] = include_bytes!("../assets/mixer.png");

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum_server::tls_rustls::RustlsConfig;
use mime_guess::MimeGuess;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    net::SocketAddr,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};

// ── shared state ──────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<Connection>>,
    scanning: Arc<AtomicBool>,
    now_playing: Arc<Mutex<Option<Value>>>,
    media_type_order: Vec<String>,
    shader_catalog: Arc<Mutex<Vec<u8>>>,
    shader_count: Arc<AtomicUsize>,
}

// ── SQL ───────────────────────────────────────────────────────────────────────

const TRACK_SELECT: &str = "
    SELECT
        steam_apps.id           AS app_id,
        steam_apps.appid,
        steam_apps.name,
        steam_apps.installdir,
        steam_apps.install_path,
        steam_apps.hq_audio,
        steam_apps.library_image,
        steam_apps.header_image,
        steam_apps.capsule_image,
        steam_apps.capsule_imagev5,
        steam_apps.steam_details,
        steam_apps.steam_store_page,
        steam_apps.steam_app_run,
        steam_apps.steam_app_friends_play,
        steam_apps.steam_app_workshop,
        steam_apps.steam_app_details,
        steam_apps.steam_app_screenshots,
        steam_apps.steam_app_validate,
        steam_files.media_type,
        steam_files.id          AS file_id,
        steam_files.title,
        steam_files.dir_path,
        steam_files.full_path,
        steam_files.file_name,
        steam_files.size,
        steam_files.modified,
        steam_files.created,
        '/cdn.media/id/' || steam_files.id || '/appid/' || steam_apps.id || '/' AS media_url
    FROM steam_apps
    LEFT JOIN steam_files ON steam_apps.installdir = steam_files.title";

const GAMES_WITH_MUSIC: &str = "
    SELECT DISTINCT
        appid, name,
        library_image, header_image, capsule_image, capsule_imagev5,
        steam_details, steam_store_page, steam_app_run,
        steam_app_screenshots, steam_app_details
    FROM steam_apps
    RIGHT JOIN steam_files ON steam_apps.installdir = steam_files.title
    ORDER BY name";

const GAMES_ALL: &str = "
    SELECT appid, name,
        library_image, header_image, capsule_image, capsule_imagev5,
        steam_details, steam_store_page, steam_app_run,
        steam_app_screenshots, steam_app_details
    FROM steam_apps
    ORDER BY name";

const ALBUMS_LIST: &str = "
    SELECT sf.title,
           COUNT(*)                               AS track_count,
           GROUP_CONCAT(DISTINCT sf.media_type)   AS types,
           MIN(sf.album_key)                      AS album_key,
           COALESCE(ast.rating, 0)                AS album_rating,
           COALESCE(SUM(ts.play_count), 0)        AS album_play_count,
           MAX(sa.capsule_image)                  AS capsule_image,
           MAX(lc.logo_url)                       AS logo_url,
           MAX(lc.capsule_url)                    AS lc_capsule_url,
           MAX(sad.capsule_image)                 AS details_capsule_image
    FROM steam_files sf
    LEFT JOIN steam_apps sa   ON sa.installdir = sf.title
    LEFT JOIN pdb.album_stats ast ON ast.album_key = sf.album_key
    LEFT JOIN pdb.track_stats  ts  ON ts.join_key  = sf.join_key
    LEFT JOIN pdb.logo_cache  lc  ON lc.appid = sa.appid
    LEFT JOIN sdb.steam_app_details sad ON sad.appid = sa.appid
    WHERE (:scan_type IS NULL OR sf.scan_type = :scan_type)
    GROUP BY sf.title
    ORDER BY sf.title";

const ALBUM_FILE_TRACKS: &str = "
    SELECT sf.id AS file_id, sf.media_type, sf.title, sf.dir_path, sf.full_path,
           sf.file_name, sf.size, sf.modified, sf.created,
           sf.join_key, sf.album_key,
           COALESCE(ts.rating,     0) AS rating,
           COALESCE(ts.play_count, 0) AS play_count,
           sf.media_class, sf.lang
    FROM steam_files sf
    LEFT JOIN pdb.track_stats ts ON ts.join_key = sf.join_key
    WHERE sf.title = :title
      AND (:type IS NULL OR UPPER(sf.media_type) = UPPER(:type))
      AND (:scan_type IS NULL OR sf.scan_type = :scan_type)
    ORDER BY sf.file_name";

const RANDOM_ALBUMS: &str = "
    SELECT DISTINCT sf.title
    FROM steam_files sf
    LEFT JOIN pdb.album_stats ast ON ast.album_key = sf.album_key
    WHERE (:type IS NULL OR UPPER(sf.media_type) = UPPER(:type))
      AND (:class IS NULL OR LOWER(sf.media_class) = LOWER(:class))
      AND COALESCE(ast.rating, 0) >= 0";

const ALBUM_TRACKS: &str = "
    SELECT steam_apps.*, steam_files.*,
        '/cdn.media/id/' || steam_files.id || '/appid/' || steam_apps.id || '/' AS media_url
    FROM steam_apps
    JOIN steam_files ON steam_apps.installdir = steam_files.title
        AND steam_files.title = :album_title
    LEFT JOIN pdb.track_stats ts ON ts.join_key = steam_files.join_key
    WHERE COALESCE(ts.rating, 0) >= 0
    ORDER BY steam_files.file_name";

const TRACK_BY_ID: &str = "
    SELECT steam_apps.*, steam_files.*,
        '/cdn.media/id/' || steam_files.id || '/appid/' || steam_apps.id || '/' AS media_url
    FROM steam_apps
    LEFT JOIN steam_files ON steam_apps.installdir = steam_files.title
    WHERE steam_files.id        = :file_id
      AND steam_apps.id         = :appid
      AND steam_files.file_name = :file_name
    LIMIT 1";

// ── DB helpers ────────────────────────────────────────────────────────────────

fn sqlite_to_json(val: rusqlite::types::Value) -> Value {
    match val {
        rusqlite::types::Value::Null => Value::Null,
        rusqlite::types::Value::Integer(n) => n.into(),
        rusqlite::types::Value::Real(f) => {
            serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
        }
        rusqlite::types::Value::Text(s) => Value::String(s),
        rusqlite::types::Value::Blob(b) => {
            Value::String(b.iter().map(|byte| format!("{byte:02x}")).collect())
        }
    }
}

fn run_query(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> Vec<Value> {
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("DB prepare: {e}");
            return vec![];
        }
    };
    let names: Vec<String> = stmt.column_names().iter().map(|&s| s.to_owned()).collect();
    stmt.query_map(params, move |row| {
        let mut map = serde_json::Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            if let Ok(val) = row.get::<usize, rusqlite::types::Value>(i) {
                map.insert(name.clone(), sqlite_to_json(val));
            }
        }
        Ok(Value::Object(map))
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

fn run_query_one(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> Option<Value> {
    run_query(conn, sql, params).into_iter().next()
}

// ── random track helpers ──────────────────────────────────────────────────────

fn pick_random_track(conn: &Connection, media_type: Option<&str>, media_class: Option<&str>) -> Option<Value> {
    let albums = run_query(conn, RANDOM_ALBUMS, rusqlite::named_params! { ":type": media_type, ":class": media_class });
    if albums.is_empty() {
        return None;
    }
    let album_title = albums[fast_rand() % albums.len()]
        .get("title")?
        .as_str()?
        .to_owned();
    let tracks = run_query(
        conn,
        ALBUM_TRACKS,
        rusqlite::named_params! { ":album_title": album_title },
    );
    if tracks.is_empty() {
        return None;
    }
    Some(tracks[fast_rand() % tracks.len()].clone())
}

fn fast_rand() -> usize {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| (d.subsec_nanos() as usize) ^ (d.as_secs() as usize).wrapping_mul(6364136223846793005))
        .unwrap_or(42)
}

// ── VLC playlist ──────────────────────────────────────────────────────────────

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn to_vlc_playlist(tracks: &[Value]) -> String {
    let mut items = String::new();
    for t in tracks {
        let path = t.get("full_path").and_then(|v| v.as_str()).unwrap_or("");
        let title = t.get("file_name").and_then(|v| v.as_str()).unwrap_or("");
        let image = t.get("header_image").and_then(|v| v.as_str()).unwrap_or("");
        let album = t.get("name").and_then(|v| v.as_str()).unwrap_or("");
        items.push_str(&format!(
            "    <track>\n\
                   <location>file://{}</location>\n\
                   <title>{}</title>\n\
                   <image>{}</image>\n\
                   <album>{}</album>\n\
                 </track>\n",
            xml_escape(path),
            xml_escape(title),
            xml_escape(image),
            xml_escape(album),
        ));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <playlist xmlns=\"http://xspf.org/ns/0/\" version=\"1\">\n\
         <trackList>\n{items}</trackList>\n</playlist>\n"
    )
}

// ── API handlers ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TracksQuery {
    #[serde(rename = "type")]
    media_type: Option<String>,
    appname: Option<String>,
}

async fn api_tracks(State(s): State<AppState>, Query(q): Query<TracksQuery>) -> Json<Value> {
    let sql = format!(
        "{TRACK_SELECT}
         WHERE (:type IS NULL OR UPPER(steam_files.media_type) = UPPER(:type))
           AND (:appname IS NULL
                OR steam_files.title LIKE '%' || :appname || '%'
                OR steam_apps.installdir LIKE '%' || :appname || '%'
                OR steam_apps.name LIKE '%' || :appname || '%')
         ORDER BY steam_files.title, steam_files.file_name"
    );
    let db = s.db.lock().unwrap();
    Json(Value::Array(run_query(
        &db,
        &sql,
        rusqlite::named_params! { ":type": q.media_type, ":appname": q.appname },
    )))
}

async fn api_games(State(s): State<AppState>) -> Json<Value> {
    let db = s.db.lock().unwrap();
    Json(Value::Array(run_query(&db, GAMES_WITH_MUSIC, ())))
}

#[derive(Deserialize)]
struct GameTracksQuery {
    appid: Option<String>,
    vlc: Option<String>,
    #[serde(rename = "type")]
    media_type: Option<String>,
}

async fn api_game_tracks(State(s): State<AppState>, Query(q): Query<GameTracksQuery>) -> Response {
    let appid = match q.appid {
        None => return (StatusCode::BAD_REQUEST, Json(json!({"error":"missing appid"}))).into_response(),
        Some(v) => v,
    };
    let sql = format!(
        "{TRACK_SELECT}
         WHERE steam_apps.appid = :appid
           AND (:type IS NULL OR UPPER(steam_files.media_type) = UPPER(:type))
         ORDER BY steam_files.title, steam_files.file_name"
    );
    let db = s.db.lock().unwrap();
    let rows = run_query(
        &db,
        &sql,
        rusqlite::named_params! { ":appid": appid, ":type": q.media_type },
    );
    if q.vlc.is_some() {
        return (
            [
                (header::CONTENT_TYPE, "application/xspf+xml"),
                (header::CONTENT_DISPOSITION, "attachment; filename=\"playlist.xspf\""),
            ],
            to_vlc_playlist(&rows),
        )
            .into_response();
    }
    Json(Value::Array(rows)).into_response()
}

async fn api_summary(State(s): State<AppState>) -> Json<Value> {
    let db = s.db.lock().unwrap();
    let by_type = run_query(
        &db,
        "SELECT media_type, COUNT(*) as count FROM steam_files GROUP BY media_type ORDER BY count DESC",
        (),
    );
    let media_type_order: Vec<Value> = s.media_type_order.iter().map(|t| Value::String(t.clone())).collect();
    let total: i64 = db
        .query_row("SELECT COUNT(*) FROM steam_files", (), |r| r.get(0))
        .unwrap_or(0);
    let soundtracks: i64 = db
        .query_row("SELECT COUNT(DISTINCT title) FROM steam_files WHERE scan_type = 'music'", (), |r| r.get(0))
        .unwrap_or(0);
    let discovered: i64 = db
        .query_row("SELECT COUNT(DISTINCT title) FROM steam_files WHERE scan_type = 'files'", (), |r| r.get(0))
        .unwrap_or(0);
    let by_class = run_query(
        &db,
        "SELECT media_class, COUNT(*) as count FROM steam_files GROUP BY media_class ORDER BY count DESC",
        (),
    );
    Json(json!({ "total": total, "by_type": by_type, "by_class": by_class, "media_type_order": media_type_order, "soundtracks": soundtracks, "discovered": discovered }))
}

async fn serve_index(State(s): State<AppState>) -> impl IntoResponse {
    let html = if s.scanning.load(Ordering::Relaxed) { LOADING_HTML } else { INDEX_HTML };
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html)
}

async fn api_status(State(s): State<AppState>) -> Json<Value> {
    Json(json!({ "scanning": s.scanning.load(Ordering::Relaxed) }))
}

async fn serve_colors_js() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/javascript")], COLORS_JS)
}

async fn serve_logo_svg() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "image/svg+xml")], LOGO_SVG)
}

async fn serve_img_coalesce_js() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/javascript")], IMG_COALESCE_JS)
}

async fn serve_visualizer_js() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/javascript")], VISUALIZER_JS)
}

async fn serve_vertexshadervis_js() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/javascript")], VERTEXSHADERVIS_JS)
}

async fn serve_mixer_js() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/javascript")], MIXER_JS)
}

async fn serve_mixer_css() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/css")], MIXER_CSS)
}

async fn serve_mixer_png() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "image/png")], MIXER_PNG)
}

async fn api_shaders(State(s): State<AppState>) -> Response {
    let bytes = s.shader_catalog.lock().unwrap().clone();
    if bytes.is_empty() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error":"catalog not ready"}))).into_response();
    }
    Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(bytes))
        .unwrap()
}

async fn api_shader_status(State(s): State<AppState>) -> Json<Value> {
    let total = s.shader_count.load(Ordering::Relaxed);
    Json(json!({ "ready": total > 0, "total": total }))
}

fn ensure_styles_css() {
    let path = std::path::Path::new("media/styles.css");
    if !path.exists() {
        if let Err(e) = std::fs::write(path, STYLES_CSS) {
            eprintln!("SERVER: failed to write media/styles.css: {e}");
        } else {
            println!("SERVER: wrote default stylesheet to media/styles.css — rename to media/userStyle.css to activate");
        }
    }
}

async fn serve_styles_css() -> impl IntoResponse {
    let css = std::fs::read_to_string("media/userStyle.css").unwrap_or_else(|_| STYLES_CSS.to_owned());
    ([(header::CONTENT_TYPE, "text/css; charset=utf-8")], css)
}


#[derive(Deserialize)]
struct AlbumsQuery {
    scan_type: Option<String>,
}

async fn api_albums(State(s): State<AppState>, Query(q): Query<AlbumsQuery>) -> Json<Value> {
    let db = s.db.lock().unwrap();
    Json(Value::Array(run_query(
        &db,
        ALBUMS_LIST,
        rusqlite::named_params! { ":scan_type": q.scan_type },
    )))
}

#[derive(Deserialize)]
struct AlbumTracksQuery {
    title: Option<String>,
    vlc: Option<String>,
    #[serde(rename = "type")]
    media_type: Option<String>,
    scan_type: Option<String>,
}

async fn api_album_tracks(State(s): State<AppState>, Query(q): Query<AlbumTracksQuery>) -> Response {
    let title = match q.title {
        None => return (StatusCode::BAD_REQUEST, Json(json!({"error":"missing title"}))).into_response(),
        Some(v) => v,
    };
    let db = s.db.lock().unwrap();
    let rows = run_query(
        &db,
        ALBUM_FILE_TRACKS,
        rusqlite::named_params! { ":title": title, ":type": q.media_type, ":scan_type": q.scan_type },
    );
    if q.vlc.is_some() {
        return (
            [
                (header::CONTENT_TYPE, "application/xspf+xml"),
                (header::CONTENT_DISPOSITION, "attachment; filename=\"playlist.xspf\""),
            ],
            to_vlc_playlist(&rows),
        )
            .into_response();
    }
    Json(Value::Array(rows)).into_response()
}

async fn serve_media(State(s): State<AppState>, Path(file_id): Path<i64>) -> Response {
    let full_path = {
        let db = s.db.lock().unwrap();
        match run_query_one(
            &db,
            "SELECT id AS file_id, full_path, file_name, media_type, title, join_key FROM steam_files WHERE id = :id",
            rusqlite::named_params! { ":id": file_id },
        ) {
            Some(t) => {
                let fp = t["full_path"].as_str().unwrap_or("").to_owned();
                let jk = t.get("join_key").and_then(|v| v.as_str()).unwrap_or("").to_owned();
                if !jk.is_empty() {
                    db.execute(
                        "INSERT INTO pdb.track_stats (join_key, play_count) VALUES (?1, 1)
                         ON CONFLICT(join_key) DO UPDATE SET play_count = play_count + 1",
                        params![jk],
                    ).ok();
                }
                *s.now_playing.lock().unwrap() = Some(t);
                fp
            }
            None => return StatusCode::NOT_FOUND.into_response(),
        }
    };
    if !PathBuf::from(&full_path).is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mime = MimeGuess::from_path(&full_path)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_owned();
    match File::open(&full_path).await {
        Ok(file) => Response::builder()
            .header(header::CONTENT_TYPE, mime)
            .body(Body::from_stream(ReaderStream::new(file)))
            .unwrap(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

#[derive(Deserialize)]
struct SearchGamesQuery {
    name: Option<String>,
}

async fn api_search_games(State(s): State<AppState>, Query(q): Query<SearchGamesQuery>) -> Json<Value> {
    let db = s.db.lock().unwrap();
    let rows = match q.name {
        Some(name) => run_query(
            &db,
            "SELECT appid, name,
                library_image, header_image, capsule_image, capsule_imagev5,
                steam_details, steam_store_page, steam_app_run,
                steam_app_screenshots, steam_app_details
             FROM steam_apps WHERE name = :name ORDER BY name",
            rusqlite::named_params! { ":name": name },
        ),
        None => run_query(&db, GAMES_ALL, ()),
    };
    Json(Value::Array(rows))
}

#[derive(Deserialize)]
struct SearchTracksQuery {
    appid: Option<String>,
    appname: Option<String>,
    #[serde(rename = "type")]
    media_type: Option<String>,
}

async fn api_search_tracks(State(s): State<AppState>, Query(q): Query<SearchTracksQuery>) -> Response {
    let sql = format!(
        "{TRACK_SELECT}
         WHERE (:appid IS NULL OR steam_apps.appid = :appid)
           AND (:appname IS NULL
                OR steam_files.title LIKE '%' || :appname || '%'
                OR steam_apps.installdir LIKE '%' || :appname || '%'
                OR steam_apps.name LIKE '%' || :appname || '%')
           AND (:type IS NULL OR UPPER(steam_files.media_type) = UPPER(:type))
         ORDER BY steam_files.title, steam_files.file_name"
    );
    let db = s.db.lock().unwrap();
    let rows = run_query(
        &db,
        &sql,
        rusqlite::named_params! { ":appid": q.appid, ":appname": q.appname, ":type": q.media_type },
    );
    Json(Value::Array(rows)).into_response()
}

async fn api_now_playing(State(s): State<AppState>) -> Response {
    match s.now_playing.lock().unwrap().clone() {
        Some(t) => Json(t).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "no track currently playing"})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct RandomQuery {
    count: Option<u32>,
    vlc: Option<String>,
    #[serde(rename = "type")]
    media_type: Option<String>,
    #[serde(rename = "class")]
    media_class: Option<String>,
}

async fn api_random_track(State(s): State<AppState>, Query(q): Query<RandomQuery>) -> Response {
    let n = q.count.unwrap_or(1).max(1).min(100) as usize;
    let db = s.db.lock().unwrap();
    let tracks: Vec<Value> = (0..n).filter_map(|_| pick_random_track(&db, q.media_type.as_deref(), q.media_class.as_deref())).collect();
    if q.vlc.is_some() {
        return (
            [(header::CONTENT_TYPE, "application/xspf+xml")],
            to_vlc_playlist(&tracks),
        )
            .into_response();
    }
    if tracks.len() == 1 {
        Json(tracks.into_iter().next().unwrap()).into_response()
    } else {
        Json(Value::Array(tracks)).into_response()
    }
}

// ── ratings ───────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RatingBody {
    key: String,
    rating: i64,
    kind: String,
}

async fn api_set_rating(State(s): State<AppState>, Json(body): Json<RatingBody>) -> StatusCode {
    let db = s.db.lock().unwrap();
    let result = if body.kind == "album" {
        db.execute(
            "INSERT INTO pdb.album_stats (album_key, rating) VALUES (?1, ?2)
             ON CONFLICT(album_key) DO UPDATE SET rating = ?2",
            params![body.key, body.rating],
        )
    } else {
        db.execute(
            "INSERT INTO pdb.track_stats (join_key, rating) VALUES (?1, ?2)
             ON CONFLICT(join_key) DO UPDATE SET rating = ?2",
            params![body.key, body.rating],
        )
    };
    if result.is_ok() { StatusCode::OK } else { StatusCode::INTERNAL_SERVER_ERROR }
}

// ── image cache ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ImageCacheQuery {
    url: String,
}

async fn api_image_cache(Query(q): Query<ImageCacheQuery>) -> Response {
    let url = q.url.clone();
    let result = tokio::task::spawn_blocking(move || -> Result<(Vec<u8>, String), StatusCode> {
        use std::hash::{Hash, Hasher};
        use std::collections::hash_map::DefaultHasher;
        use std::io::Read;

        let cache_dir = PathBuf::from("cache/images");
        std::fs::create_dir_all(&cache_dir)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let mut hasher = DefaultHasher::new();
        url.hash(&mut hasher);
        let hash = hasher.finish();

        let ext = url.split('?').next().unwrap_or(&url)
            .rsplit('.').next()
            .filter(|e| ["jpg","jpeg","png","webp","gif"].contains(e))
            .unwrap_or("jpg");

        let cache_path = cache_dir.join(format!("{hash:016x}.{ext}"));

        if !cache_path.exists() {
            let resp = ureq::get(&url).call().map_err(|_| StatusCode::BAD_GATEWAY)?;
            let mut buf = Vec::new();
            resp.into_reader().read_to_end(&mut buf).map_err(|_| StatusCode::BAD_GATEWAY)?;
            std::fs::write(&cache_path, &buf).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }

        let data = std::fs::read(&cache_path).map_err(|_| StatusCode::NOT_FOUND)?;
        let mime = MimeGuess::from_path(&cache_path).first_raw().unwrap_or("image/jpeg").to_owned();
        Ok((data, mime))
    }).await;

    match result {
        Ok(Ok((data, mime))) => Response::builder()
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "public, max-age=604800")
            .body(Body::from(data))
            .unwrap(),
        Ok(Err(status)) => status.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// ── CDN ───────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CdnParams {
    file_id: String,
    appid: String,
    file_name: String,
}

fn lookup_track(conn: &Connection, p: &CdnParams) -> Option<(Value, String)> {
    let file_id: i64 = p.file_id.parse().ok().filter(|&n| n > 0)?;
    let appid: i64 = p.appid.parse().ok().filter(|&n| n > 0)?;
    if p.file_name.trim().is_empty() {
        return None;
    }
    let track = run_query_one(
        conn,
        TRACK_BY_ID,
        rusqlite::named_params! {
            ":file_id": file_id,
            ":appid": appid,
            ":file_name": p.file_name,
        },
    )?;
    let full_path = track.get("full_path")?.as_str()?.to_owned();
    if !PathBuf::from(&full_path).is_file() {
        return None;
    }
    let mime = MimeGuess::from_path(&full_path)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_owned();
    Some((track, mime))
}

async fn cdn_validate(State(s): State<AppState>, Path(p): Path<CdnParams>) -> StatusCode {
    let db = s.db.lock().unwrap();
    if lookup_track(&db, &p).is_some() {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn cdn_serve(State(s): State<AppState>, Path(p): Path<CdnParams>) -> Response {
    let (track, mime, full_path) = {
        let db = s.db.lock().unwrap();
        match lookup_track(&db, &p) {
            Some((t, m)) => {
                let fp = t["full_path"].as_str().unwrap_or("").to_owned();
                let jk = t.get("join_key").and_then(|v| v.as_str()).unwrap_or("").to_owned();
                if !jk.is_empty() {
                    db.execute(
                        "INSERT INTO pdb.track_stats (join_key, play_count) VALUES (?1, 1)
                         ON CONFLICT(join_key) DO UPDATE SET play_count = play_count + 1",
                        params![jk],
                    ).ok();
                }
                (t, m, fp)
            }
            None => {
                return (StatusCode::NOT_FOUND, Json(json!({"error":"not found"}))).into_response()
            }
        }
    };
    *s.now_playing.lock().unwrap() = Some(track);
    match File::open(&full_path).await {
        Ok(file) => Response::builder()
            .header(header::CONTENT_TYPE, mime)
            .body(Body::from_stream(ReaderStream::new(file)))
            .unwrap(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── background app-details updater ───────────────────────────────────────────

#[cfg(feature = "details-updater")]
fn mark_app_detail_error(conn: &Connection, appid: &str) -> Result<(), rusqlite::Error> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned());

    conn.execute(
        "UPDATE steam_app_details SET date_updated = ?, error = 1 WHERE appid = ?",
        params![now, appid],
    )?;
    Ok(())
}

#[cfg(feature = "details-updater")]
fn spawn_details_updater(steam_details_db: String) {
    std::thread::spawn(move || {
        let conn = match rusqlite::Connection::open(&steam_details_db) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("DETAILS: failed to open steam_details.db: {e}");
                return;
            }
        };
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;").ok();

        loop {

            let row: Option<(String, String)> = conn
                .query_row(
                    "SELECT appid, title FROM steam_app_details WHERE date_updated IS NULL order by title LIMIT 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();

            let (appid, title) = match row {
                None => {
                    println!("DETAILS: all apps processed");
                    break;
                }
                Some(r) => r,
            };

            std::thread::sleep(std::time::Duration::from_millis(1500));
            println!("DETAILS: fetching {title} ({appid})");
            let url = format!("http://store.steampowered.com/api/appdetails?appids={appid}");
            
            let response: serde_json::Value = match ureq::get(&url).call() {
                Err(ureq::Error::Status(code, resp)) => {
                    let body = resp.into_string().unwrap_or_default();
                    eprintln!("ERROR DETAILS: HTTP {code} for {appid}: {body}");
                    break;
                }
                Err(e) => {
                    eprintln!("ERROR DETAILS: network error for {appid}: {e}");
                    break;
                }
                Ok(resp) => match resp.into_json() {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("ERROR DETAILS: failed to parse response for {appid}: {e}");
                        if let Err(e) = mark_app_detail_error(&conn, &appid) {
                            eprintln!("ERROR DATABASE FAILED TO MARK ERROR DETAILS: db update error for {appid}: {e}");
                            break;
                        }
                        continue;
                    }
                },
            };

            if response[&appid]["success"].as_bool() != Some(true) {
                eprintln!("ERROR DETAILS: steam returned success=false for {appid}: {response}");
                if let Err(e) = mark_app_detail_error(&conn, &appid) {
                    eprintln!("ERROR DATABASE FAILED TO MARK ERROR DETAILS: db update error for {appid}: {e}");
                    break;
                }
                continue;
            }

            let data = &response[&appid]["data"];

            let app_type = data["type"].as_str().map(str::to_owned);

            if !matches!(app_type.as_deref(), Some("game") | Some("music")) {
                conn.execute("DELETE FROM steam_app_details WHERE appid = ?", params![appid]).ok();
                continue;
            }

            let actual_title = data["name"].as_str().unwrap_or(&title).to_owned();
            let is_free = data["is_free"].as_bool().map(|b| b as i64);
            let short_desc = data["short_description"].as_str().map(str::to_owned);
            let header_image = data["header_image"].as_str().map(str::to_owned);
            let capsule_image = data["capsule_image"].as_str().map(str::to_owned);
            let capsule_imagev5 = data["capsule_imagev5"].as_str().map(str::to_owned);
            let website = data["website"].as_str().map(str::to_owned);
            let publisher = data["publishers"].as_array().map(|arr| {
                arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", ")
            });
            let developer = data["developers"].as_array().map(|arr| {
                arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", ")
            });
            let parent_id = data["fullgame"]["appid"].as_str().map(str::to_owned);

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs().to_string())
                .unwrap_or_else(|_| "0".to_owned());

            if let Err(e) = conn.execute(
                "UPDATE steam_app_details SET
                    title = ?, date_updated = ?, parent_id = ?,
                    type = ?, is_free = ?, short_description = ?,
                    header_image = ?, capsule_image = ?, capsule_imagev5 = ?,
                    website = ?, publisher = ?, developer = ?
                 WHERE appid = ?",
                params![
                    actual_title, now, parent_id,
                    app_type, is_free, short_desc,
                    header_image, capsule_image, capsule_imagev5,
                    website, publisher, developer,
                    appid,
                ],
            ) {
                eprintln!("DETAILS: db update error for {appid}: {e}");
                break;
            }

            if let Some(dlc_arr) = data["dlc"].as_array() {
                for dlc_id in dlc_arr {
                    if let Some(id) = dlc_id.as_u64() {
                        let placeholder = format!("{actual_title} DLC #{id}");
                        conn.execute(
                            "INSERT OR IGNORE INTO steam_app_details (appid, title, parent_id) VALUES (?,?,?)",
                            params![id.to_string(), placeholder, appid.to_string()],
                        )
                        .ok();
                    }
                }
            }
        }
    });
}

// ── TLS cert generation ───────────────────────────────────────────────────────

fn ensure_certs(cert_path: &str, key_path: &str) {
    use std::{fs, path::Path};
    if Path::new(cert_path).exists() && Path::new(key_path).exists() {
        println!("SERVER: using existing certs");
        return;
    }
    println!("SERVER: generating self-signed TLS certificate...");
    if let Some(dir) = Path::new(cert_path).parent() {
        fs::create_dir_all(dir).unwrap_or_else(|e| {
            eprintln!("ERROR: cannot create certs dir: {e}");
            std::process::exit(1);
        });
    }
    let rcgen::CertifiedKey { cert, key_pair } = rcgen::generate_simple_self_signed(vec![
        "localhost".to_owned(),
        "127.0.0.1".to_owned(),
    ])
    .unwrap_or_else(|e| {
        eprintln!("ERROR: cert generation failed: {e}");
        std::process::exit(1);
    });
    fs::write(cert_path, cert.pem()).unwrap_or_else(|e| {
        eprintln!("ERROR: writing cert: {e}");
        std::process::exit(1);
    });
    fs::write(key_path, key_pair.serialize_pem()).unwrap_or_else(|e| {
        eprintln!("ERROR: writing key: {e}");
        std::process::exit(1);
    });
    println!("SERVER: self-signed certs written to {cert_path} / {key_path}");
    println!("SERVER: NOTE — for production use certbot with a public domain, not self-signed certs");
}

// ── startup ───────────────────────────────────────────────────────────────────

pub async fn start(
    bind_addr: &str,
    db: Arc<Mutex<Connection>>,
    scanning: Arc<AtomicBool>,
    media_type_order: Vec<String>,
    steam_details_db: String,
    shader_count: Arc<AtomicUsize>,
    shader_catalog: Arc<Mutex<Vec<u8>>>,
) {
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .ok();

    const CERT: &str = ".secrets/cert.pem";
    const KEY: &str = ".secrets/key.pem";

    ensure_certs(CERT, KEY);
    ensure_styles_css();

    let state = AppState {
        db,
        scanning,
        now_playing: Arc::new(Mutex::new(None)),
        media_type_order,
        shader_catalog,
        shader_count,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(serve_index))
        .route("/api/status", get(api_status))
        .route("/colors.js", get(serve_colors_js))
        .route("/logo.svg", get(serve_logo_svg))
        .route("/styles.css", get(serve_styles_css))
        .route("/ImgCoalesce.js", get(serve_img_coalesce_js))
        .route("/visualizer.js", get(serve_visualizer_js))
        .route("/VSA_shadercore.js", get(serve_vertexshadervis_js))
        .route("/mixer.js", get(serve_mixer_js))
        .route("/mixer.css", get(serve_mixer_css))
        .route("/assets/mixer.png", get(serve_mixer_png))
        .route("/api/summary", get(api_summary))
        .route("/api/albums", get(api_albums))
        .route("/api/album/tracks", get(api_album_tracks))
        .route("/media/{file_id}", get(serve_media))
        .route("/api/tracks", get(api_tracks))
        .route("/api/games", get(api_games))
        .route("/api/game/tracks", get(api_game_tracks))
        .route("/api/search/games", get(api_search_games))
        .route("/api/search/tracks", get(api_search_tracks))
        .route("/api/nowplaying", get(api_now_playing))
        .route("/api/random/track", get(api_random_track))
        .route("/api/random/game/music", get(api_random_track))
        .route("/api/rating", post(api_set_rating))
        .route("/api/image-cache", get(api_image_cache))
        .route("/api/shaders", get(api_shaders))
        .route("/api/shader-status", get(api_shader_status))
        .route(
            "/api/validate/cdn.media/id/{file_id}/appid/{appid}/{file_name}",
            get(cdn_validate),
        )
        .route(
            "/cdn.media/id/{file_id}/appid/{appid}/{file_name}",
            get(cdn_serve),
        )
        .with_state(state)
        .layer(cors);

    let addr: SocketAddr = bind_addr.parse().unwrap_or_else(|e| {
        eprintln!("ERROR: invalid bind address '{bind_addr}': {e}");
        std::process::exit(1);
    });

    let tls = RustlsConfig::from_pem_file(CERT, KEY).await.unwrap_or_else(|e| {
        eprintln!("ERROR: loading TLS config: {e}");
        std::process::exit(1);
    });

    #[cfg(feature = "details-updater")]
    spawn_details_updater(steam_details_db.to_owned());

    println!("SERVER: https://{addr}");
    println!("  /api/tracks");
    println!("  /api/games");
    println!("  /api/game/tracks?appid=<id>");
    println!("  /api/search/games[?name=<n>]");
    println!("  /api/search/tracks?appid=<id>");
    println!("  /api/random/track[?count=N][&vlc]");
    println!("  /api/random/game/music[?count=N][&vlc]");
    println!("  /api/nowplaying");
    println!("  /cdn.media/id/:file_id/appid/:appid/:file_name");

    axum_server::bind_rustls(addr, tls)
        .serve(app.into_make_service())
        .await
        .unwrap_or_else(|e| eprintln!("SERVER error: {e}"));
}
