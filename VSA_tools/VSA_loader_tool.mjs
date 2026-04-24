import Database from 'better-sqlite3'
import { readFileSync, readdirSync, statSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

mkdirSync(join(ROOT, 'media'), { recursive: true })

const db = new Database(join(ROOT, 'media/VSA_shaders.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS vsa_ratings (
    _id TEXT PRIMARY KEY,
    rating INTEGER NOT NULL DEFAULT 0,
    foreground INTEGER,
    background INTEGER,
    mouse INTEGER
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS vsa_shaders (
    _id TEXT PRIMARY KEY,
    owner_id TEXT,
    owner_username TEXT,
    owner_avatar_url TEXT,
    owner_created_at INTEGER,
    created_at INTEGER,
    modified_at INTEGER,
    orig_id TEXT,
    name TEXT,
    notes TEXT,
    rank REAL,
    private INTEGER,
    unlisted INTEGER,
    username TEXT,
    avatar_url TEXT,
    settings_num INTEGER,
    settings_mode TEXT,
    settings_sound TEXT,
    settings_line_size TEXT,
    settings_background_color TEXT,
    settings_shader TEXT,
    screenshot_url TEXT,
    has_sound INTEGER,
    views INTEGER,
    likes INTEGER,
    revision_id TEXT
  )
`)

const insert = db.prepare(`
  INSERT OR REPLACE INTO vsa_shaders VALUES (
    @_id,
    @owner_id,
    @owner_username,
    @owner_avatar_url,
    @owner_created_at,
    @created_at,
    @modified_at,
    @orig_id,
    @name,
    @notes,
    @rank,
    @private,
    @unlisted,
    @username,
    @avatar_url,
    @settings_num,
    @settings_mode,
    @settings_sound,
    @settings_line_size,
    @settings_background_color,
    @settings_shader,
    @screenshot_url,
    @has_sound,
    @views,
    @likes,
    @revision_id
  )
`)

const MIN_CODE_LINES = 48

const process_art_json = (filepath) => {
  const data = JSON.parse(readFileSync(filepath, 'utf8'))

  const code = data.settings?.shader ?? ''
  const line_count = code.split('\n').length
  if (line_count < MIN_CODE_LINES) {
    console.log(`Skipped (${line_count} lines): ${filepath}`)
    return
  }

  insert.run({
    _id: data._id,
    owner_id: data.owner?._id || null,
    owner_username: data.owner?.username || null,
    owner_avatar_url: data.owner?.profile?.avatarUrl || null,
    owner_created_at: data.owner?.createdAt?.$date || null,
    created_at: data.createdAt?.$date || null,
    modified_at: data.modifiedAt?.$date || null,
    orig_id: data.origId,
    name: data.name,
    notes: data.notes,
    rank: data.rank,
    private: data.private ? 1 : 0,
    unlisted: data.unlisted ? 1 : 0,
    username: data.username,
    avatar_url: data.avatarUrl,
    settings_num: data.settings?.num || null,
    settings_mode: data.settings?.mode || null,
    settings_sound: data.settings?.sound || null,
    settings_line_size: data.settings?.lineSize || null,
    settings_background_color: data.settings?.backgroundColor ? JSON.stringify(data.settings.backgroundColor) : null,
    settings_shader: data.settings?.shader || null,
    screenshot_url: data.screenshotURL,
    has_sound: data.hasSound ? 1 : 0,
    views: data.views,
    likes: data.likes,
    revision_id: data.revisionId
  })
}

const scan_directory = (dir) => {
  const entries = readdirSync(dir)

  for (const entry of entries) {
    const full_path = join(dir, entry)
    const stat = statSync(full_path)

    if (stat.isDirectory()) {
      scan_directory(full_path)
    } else if (entry === 'art.json') {
      process_art_json(full_path)
    }
  }
}

const SHADERS_DIR = join(ROOT, 'VSA_shaders')

console.log('Creating database and table...')
console.log(`Scanning ${SHADERS_DIR} for art.json files...`)

scan_directory(SHADERS_DIR)

const count = db.prepare('SELECT COUNT(*) as count FROM vsa_shaders').get()
console.log(`\nComplete! Inserted ${count.count} shaders into the database.`)

db.close()
