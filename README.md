# MusicTower — Steam Music Server

A fast, self-hosted media server that scans your Steam libraries for soundtracks and game audio, then streams them through a built-in web player and REST API.

On first launch it walks you through Steam authentication in your browser. After that, point any compatible player at the API and start listening.

---

## Screenshots

### First-time Setup (Steam Login)

When you run this from the console you will see a message to look for the browser that has a steam login button.

![screenshot: onboarding — Steam OpenID login page](docs/screenshots/onboarding.png)

### TEST SSL CERT WARNING
This server binds to local host IP address and runs only locally on your machine so we can't get a proper server certificate for this (yet, there are ways, bit it is a PITA!)

To use the built in web client you will need to accept the test certificate.

1. Click Show Advanced
2. Click proceed to... 

![screenshot: you will be warned about using the test certificate. It's ok.](docs/screenshots/safety.png)

---

### Web Player (LOCALHOST)

![screenshot: main player view — Sound Tracks and Discovered Media sections](docs/screenshots/player.png)

---

## Features

- Scans all configured Steam library paths for audio (and mp4) files (file types are configurable)
- On Windows, auto-discovers Steam install location from the registry; additional library paths (external drives, etc.) are merged from `libraryfolders.vdf`
- Separates **Sound Tracks** (Steam music library) from **Discovered Media** (game audio found in `steamapps/common`)
- Built-in web player with track queueing, auto-advance, and per-album media-type filtering
- Download a filtered VLC-compatible XSPF playlist for any album with one click
- REST API so external players can query and stream your library
- Two persistent databases: `starkeeper.db` (rebuilt on every scan) and `steam_details.db` (persists metadata and state across scans)

---

## Requirements

- [Rust](https://rustup.rs) 1.75 or later
- A Steam installation with at least one library

---

## Building

```sh
git clone https://github.com/your-org/SteamMusicServer
cd SteamMusicServer
cargo build --release
```

The binary is written to `target/release/music_tower`.

On Windows, `winreg` is compiled in automatically to read the Steam registry key — no extra steps needed.

---

## First-time Setup

On the first run, if `STEAM_ID` or `STEAM_API_KEY` are not set, the server opens a local setup page at `http://localhost:7357` and tries to launch your browser automatically.

1. Click **Sign in through Steam** — this uses Steam's OpenID login, no password is sent to this app.
2. After login you are redirected back to the setup page.
3. Paste your Steam Web API key (get one at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)) and click **Save**.

Credentials are written to a `.env` file in the working directory and loaded automatically on every subsequent launch. You can also set them as environment variables directly (see [Configuration](#configuration)).

---

## Configuration

The default config file is `config/scanner_conf.yaml`. Pass a different path as the first argument if needed.

```yaml
db_file: media/starkeeper.db

media_type:
  - mp3
  - ogg
  - oga
  - opus
  - webm
  - flac
  - wav
  - aiff
  - m4a
  - mp4
  - midi
  - mid
  - aac

scan_roots:
  - $HOME/.steam/steam/steamapps/music/
  - $HOME/.steam/steam/steamapps/common/
  # Add extra library paths for external drives, e.g.:
  # - /mnt/games/SteamLibrary/steamapps/music/
  # - /mnt/games/SteamLibrary/steamapps/common/
```

**`db_file`** — path to the main scan database (created or replaced on each run).

**`media_type`** — file extensions to index. Add or remove types to control what gets scanned.

**`scan_roots`** — directories to walk recursively. Environment variables (`$HOME`, `$USERPROFILE`, etc.) are expanded at startup. On Windows, Steam library paths are also discovered automatically from the registry and merged with any paths listed here. A warning is printed for any path that does not exist; scanning continues with the rest.

Paths ending in `steamapps/music` are tagged `scan_type=music` (shown under **Sound Tracks**). All other paths are tagged `scan_type=files` (shown under **Discovered Media**).

### Credentials

Set these as environment variables or let the first-time setup write them to `.env`:

```sh
STEAM_API_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
STEAM_ID=XXXXXXXXXXXXXXXXX
```

`STEAM_API_KEY` is used to fetch your owned games list so the server can associate audio files with the correct game titles. Get a key at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey).

`STEAM_ID` is your 64-bit Steam ID (visible in your profile URL or at [steamidfinder.com](https://steamidfinder.com)).

---

## Usage

```sh
# Scan and serve (default — listens on https://127.0.0.1:8086)
./music_tower

# Specify a different config file
./music_tower path/to/my_config.yaml

# Bind to a different address
./music_tower --serve=0.0.0.0:9000

# Scan only, no web server
./music_tower --no-serve
```

On startup the server scans all configured roots, rebuilds `starkeeper.db`, then starts serving. Open the address shown in the terminal to use the web player.

The server uses a self-signed TLS certificate generated at runtime. Your browser will show a certificate warning — this is expected for a local server. Add a permanent exception or use `--serve=` with a reverse proxy that provides a real certificate.

---

## API

All responses are JSON. The base URL is `https://127.0.0.1:8086` by default.

| Endpoint | Description |
|---|---|
| `GET /api/summary` | File counts by type, soundtrack and media collection totals |
| `GET /api/albums?scan_type=music` | Albums list (`scan_type`: `music` or `files`) |
| `GET /api/album/tracks?title=…&scan_type=…` | Tracks for a specific album |
| `GET /api/album/tracks?title=…&scan_type=…&vlc=1` | Same, as an XSPF playlist |
| `GET /api/album/tracks?…&type=MP3` | Filter tracks by media type |
| `GET /api/tracks?appname=…&media_type=…` | Search tracks across all albums |
| `GET /api/games/search?name=…` | Search installed Steam games |
| `GET /api/random` | A random track (optional `?media_type=MP3`) |
| `GET /media/:file_id` | Stream a file by its database ID |

---

## Databases

**`starkeeper.db`** is recreated on every run. It holds the full scan results: Steam app metadata, owned games, and indexed file paths. Previous copies are renamed `_0001_starkeeper.db`, `_0002_starkeeper.db`, etc. before each run.

**`steam_details.db`** persists across runs. It holds Steam app details fetched from the API and is used to enrich metadata without re-fetching on every scan.

---

## Related Projects

- Compatible CLI player — coming soon
- Game showcase player — coming soon

---

## Contributing

Pull requests are welcome. For larger changes, opening an issue first to discuss the approach is appreciated.

```sh
# Run a development build
cargo build

# Check for warnings and errors without producing a binary
cargo check

# Run tests
cargo test
```

Please keep code style consistent with the existing Rust (edition 2021) and match the JavaScript style used in `src/index.html` (ES modules, async/await, snake_case, no semicolons).
