use axum::{
    extract::{Query, State},
    http::header,
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Form, Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

const SETUP_PORT: u16 = 7357;

pub struct SetupResult {
    pub steam_id: String,
    pub api_key: String,
}

#[derive(Clone)]
struct SetupState {
    pending_steam_id: Arc<Mutex<Option<String>>>,
    done_tx: Arc<Mutex<Option<oneshot::Sender<SetupResult>>>>,
    port: u16,
}

pub async fn run_setup() -> SetupResult {
    let port = SETUP_PORT;
    let (done_tx, done_rx) = oneshot::channel::<SetupResult>();

    let state = SetupState {
        pending_steam_id: Arc::new(Mutex::new(None)),
        done_tx: Arc::new(Mutex::new(Some(done_tx))),
        port,
    };

    let app = Router::new()
        .route("/", get(page_login))
        .route("/auth/steam", get(auth_steam))
        .route("/auth/callback", get(auth_callback))
        .route("/auth/apikey", post(auth_apikey))
        .with_state(state);

    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        eprintln!("SETUP: failed to bind {addr}: {e}");
        std::process::exit(1);
    });

    let url = format!("http://localhost:{port}");
    println!("SETUP: opening {url}");
    try_open_browser(&url);

    let server_task = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    let result = done_rx.await.unwrap_or_else(|_| {
        eprintln!("SETUP: interrupted");
        std::process::exit(1);
    });

    server_task.abort();
    result
}

fn try_open_browser(url: &str) {
    let _ = if cfg!(target_os = "windows") {
        std::process::Command::new("cmd").args(["/c", "start", url]).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(url).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(url).spawn()
    };
}

// ── handlers ──────────────────────────────────────────────────────────────────

async fn page_login() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], LOGIN_HTML)
}

async fn auth_steam(State(s): State<SetupState>) -> impl IntoResponse {
    let port = s.port;
    let return_to = format!("http%3A%2F%2Flocalhost%3A{port}%2Fauth%2Fcallback");
    let realm     = format!("http%3A%2F%2Flocalhost%3A{port}%2F");
    let url = format!(
        "https://steamcommunity.com/openid/login\
        ?openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0\
        &openid.mode=checkid_setup\
        &openid.return_to={return_to}\
        &openid.realm={realm}\
        &openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select\
        &openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
    );
    Redirect::to(&url)
}

async fn auth_callback(
    State(s): State<SetupState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let mode = params.get("openid.mode").map(|s| s.as_str()).unwrap_or("");
    if mode != "id_res" {
        return html(error_page("Steam login was cancelled or failed.", "/", "Try again"));
    }

    let claimed_id = match params.get("openid.claimed_id") {
        Some(id) => id.clone(),
        None => return html(error_page("No Steam ID in response.", "/", "Try again")),
    };

    let steam_id = match claimed_id.rsplit('/').next() {
        Some(id) if id.len() == 17 && id.chars().all(|c| c.is_ascii_digit()) => id.to_owned(),
        _ => return html(error_page("Could not parse Steam ID from response.", "/", "Try again")),
    };

    if !validate_openid(&params).await {
        return html(error_page("Steam could not verify the login.", "/", "Try again"));
    }

    *s.pending_steam_id.lock().unwrap() = Some(steam_id.clone());
    html(apikey_page(&steam_id))
}

#[derive(Deserialize)]
struct ApiKeyForm {
    api_key: String,
}

async fn auth_apikey(
    State(s): State<SetupState>,
    Form(form): Form<ApiKeyForm>,
) -> Response {
    let api_key = form.api_key.trim().to_owned();
    if api_key.is_empty() {
        return html(error_page("API key cannot be empty.", "javascript:history.back()", "Go back"));
    }

    let steam_id = match s.pending_steam_id.lock().unwrap().clone() {
        Some(id) => id,
        None => return html(error_page("Session expired.", "/", "Start over")),
    };

    match save_dotenv(&steam_id, &api_key) {
        Ok(()) => println!("SETUP: saved STEAM_ID and STEAM_API_KEY to .env"),
        Err(e) => eprintln!("SETUP: failed to write .env: {e}"),
    }

    if let Some(tx) = s.done_tx.lock().unwrap().take() {
        tx.send(SetupResult { steam_id, api_key }).ok();
    }

    html(DONE_HTML.to_owned())
}

// ── OpenID validation ─────────────────────────────────────────────────────────

async fn validate_openid(params: &HashMap<String, String>) -> bool {
    let mut parts: Vec<String> = Vec::new();
    let mut saw_mode = false;
    for (k, v) in params {
        if k == "openid.mode" {
            parts.push("openid.mode=check_authentication".to_owned());
            saw_mode = true;
        } else {
            parts.push(format!("{}={}", pct_encode(k), pct_encode(v)));
        }
    }
    if !saw_mode {
        parts.push("openid.mode=check_authentication".to_owned());
    }
    let body = parts.join("&");

    tokio::task::spawn_blocking(move || {
        ureq::post("https://steamcommunity.com/openid/login")
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send_string(&body)
            .map(|r| r.into_string().unwrap_or_default().contains("is_valid:true"))
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ── .env ──────────────────────────────────────────────────────────────────────

fn save_dotenv(steam_id: &str, api_key: &str) -> std::io::Result<()> {
    let mut lines: Vec<String> = Vec::new();
    if let Ok(existing) = std::fs::read_to_string(".env") {
        for line in existing.lines() {
            let key = line.split('=').next().unwrap_or("").trim();
            if key != "STEAM_ID" && key != "STEAM_API_KEY" {
                lines.push(line.to_owned());
            }
        }
    }
    lines.push(format!("STEAM_ID={steam_id}"));
    lines.push(format!("STEAM_API_KEY={api_key}"));
    std::fs::write(".env", lines.join("\n") + "\n")
}

pub fn load_dotenv() {
    let Ok(content) = std::fs::read_to_string(".env") else { return };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue }
        if let Some((key, val)) = line.split_once('=') {
            let key = key.trim();
            let val = val.trim().trim_matches('"');
            if std::env::var(key).is_err() {
                std::env::set_var(key, val);
            }
        }
    }
}

// ── HTML ──────────────────────────────────────────────────────────────────────

fn html(body: String) -> Response {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response()
}

fn error_page(msg: &str, href: &str, link_text: &str) -> String {
    format!(r#"<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Setup — Starkeeper Media</title>{STYLE}</head><body>
<div class="card">
  <div class="logo">⭐</div>
  <h1>Starkeeper Media</h1>
  <p class="step">Setup</p>
  <div class="info" style="border-color:#c05050;background:#2a1818;">
    <strong style="color:#f88">Error:</strong> {msg}
  </div>
  <a class="btn" href="{href}">{link_text}</a>
</div></body></html>"#)
}

fn apikey_page(steam_id: &str) -> String {
    format!(r##"<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>API Key — Starkeeper Media</title>{STYLE}</head><body>
<div class="card">
  <div class="logo">⭐</div>
  <h1>Starkeeper Media</h1>
  <p class="step">Step 2 of 2 — Steam API Key</p>
  <div class="info">
    <strong style="color:#afa">✓ Signed in &nbsp;</strong>
    Steam ID: <code>{steam_id}</code><br><br>
    Now you need a <strong>Steam Web API key</strong>. Get one free at:<br>
    <a href="https://steamcommunity.com/dev/apikey" target="_blank"
       style="color:#66c0f4">steamcommunity.com/dev/apikey</a><br><br>
    Register any domain (e.g. <code>localhost</code>) and paste the key below.
  </div>
  <form method="POST" action="/auth/apikey">
    <input name="api_key" type="text"
           placeholder="Steam Web API Key (32 hex characters)"
           autocomplete="off" spellcheck="false">
    <button type="submit" class="btn" style="display:block;width:100%;margin-top:10px">
      Save &amp; Start Scanner
    </button>
  </form>
  <p class="privacy">Your API key is written only to a local <code>.env</code> file.
  It is never sent anywhere except Steam's official API endpoint.</p>
</div></body></html>"##)
}

const DONE_HTML: &str = r#"<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Setup Complete — Starkeeper Media</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.6 system-ui,monospace;background:#0e0e16;color:#ccc;
     display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#161622;border:1px solid #2a2a40;border-radius:12px;
      padding:40px 48px;max-width:520px;width:100%;text-align:center}
.logo{font-size:3em;margin-bottom:8px}
h1{color:#e8c040;font-size:1.4em;margin-bottom:6px}
p{color:#aaa;margin-bottom:12px}
a{color:#66c0f4}
.ok{color:#afa;font-size:1.1em;margin:20px 0}
</style>
</head><body>
<div class="card">
  <div class="logo">⭐</div>
  <h1>Starkeeper Media</h1>
  <p class="ok">✓ Setup complete!</p>
  <p>Your credentials have been saved to <code>.env</code>.<br>
  The scanner is now starting — this may take a moment.</p>
  <p style="margin-top:20px">Once ready, the app will be at<br>
  <a href="https://localhost:8086" target="_blank">https://localhost:8086</a></p>
</div></body></html>"#;

const LOGIN_HTML: &str = r##"<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Setup — Starkeeper Media</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.6 system-ui,monospace;background:#0e0e16;color:#ccc;
     display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#161622;border:1px solid #2a2a40;border-radius:12px;
      padding:40px 48px;max-width:520px;width:100%}
.logo{font-size:2.8em;margin-bottom:8px}
h1{color:#e8c040;font-size:1.4em;margin-bottom:4px}
.step{color:#7a9;font-size:0.88em;margin-bottom:24px}
.info{background:#1e1e2e;border-left:3px solid #4a7a5a;padding:14px 16px;
      border-radius:0 6px 6px 0;margin-bottom:24px;font-size:0.88em;line-height:1.8}
.info strong{color:#afa}
.info code{background:#252535;padding:1px 5px;border-radius:3px;font-size:0.92em}
.btn{display:inline-flex;align-items:center;gap:10px;
     background:#1b2838;border:1px solid #4c6b8a;color:#c6d4df;
     text-decoration:none;padding:12px 22px;border-radius:4px;
     font-size:0.95em;cursor:pointer;transition:background 0.15s;font-family:inherit}
.btn:hover{background:#2a475e;border-color:#66c0f4;color:#fff}
.privacy{color:#555;font-size:0.82em;margin-top:18px;line-height:1.5}
.privacy code{background:#1a1a2a;padding:1px 4px;border-radius:2px}
</style>
</head><body>
<div class="card">
  <div class="logo">⭐</div>
  <h1>Starkeeper Media</h1>
  <p class="step">First-time Setup — Step 1 of 2</p>
  <div class="info">
    <strong>What's about to happen:</strong><br>
    1. You'll sign in with Steam to identify your account<br>
    2. You'll provide a Steam Web API key (we'll walk you through it)<br>
    3. Both are saved to a local <code>.env</code> file on this machine
  </div>
  <a class="btn" href="/auth/steam">
    <svg width="20" height="20" viewBox="0 0 233 233" fill="#66c0f4">
      <path d="M116.5 0C52.1 0 0 52.1 0 116.5c0 55.4 38.7 101.8 90.6 113.5
               l30.8-73.5c-2.2.3-4.5.5-6.8.5-26.5 0-48-21.5-48-48s21.5-48
               48-48 48 21.5 48 48c0 22.5-15.5 41.4-36.4 46.7L97.4 228
               c6.2 1.6 12.7 2.5 19.3 2.5 64.4 0 116.5-52.1
               116.5-116.5S180.9 0 116.5 0z"/>
    </svg>
    Sign in with Steam
  </a>
  <p class="privacy">Nothing is transmitted to any server other than Steam's official
  authentication service. Your credentials are stored only in a local
  <code>.env</code> file and are never uploaded anywhere.</p>
</div></body></html>"##;

const STYLE: &str = r#"<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.6 system-ui,monospace;background:#0e0e16;color:#ccc;
     display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#161622;border:1px solid #2a2a40;border-radius:12px;
      padding:40px 48px;max-width:520px;width:100%}
.logo{font-size:2.8em;margin-bottom:8px}
h1{color:#e8c040;font-size:1.4em;margin-bottom:4px}
.step{color:#7a9;font-size:0.88em;margin-bottom:24px}
.info{background:#1e1e2e;border-left:3px solid #4a7a5a;padding:14px 16px;
      border-radius:0 6px 6px 0;margin-bottom:24px;font-size:0.88em;line-height:1.8}
.info strong{color:#afa}
.info code{background:#252535;padding:1px 5px;border-radius:3px;font-size:0.92em}
.info a{color:#66c0f4}
input{display:block;width:100%;background:#1e1e2e;border:1px solid #3a3a5a;
      color:#fff;padding:10px 14px;border-radius:4px;font:inherit;margin-bottom:4px}
input:focus{outline:none;border-color:#66c0f4}
.btn{display:inline-flex;align-items:center;gap:10px;
     background:#1b2838;border:1px solid #4c6b8a;color:#c6d4df;
     text-decoration:none;padding:12px 22px;border-radius:4px;
     font-size:0.95em;cursor:pointer;transition:background 0.15s;font-family:inherit}
.btn:hover{background:#2a475e;border-color:#66c0f4;color:#fff}
.privacy{color:#555;font-size:0.82em;margin-top:18px;line-height:1.5}
.privacy code{background:#1a1a2a;padding:1px 4px;border-radius:2px}
</style>"#;
