use rusqlite::Connection;
use serde_json::Value;

pub fn load_from_db(db_path: &str) -> (Vec<u8>, usize) {
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("SHADERS: failed to open {db_path}: {e}");
            return (b"[]".to_vec(), 0);
        }
    };

    let sql = "SELECT _id, name, settings_num, settings_mode, settings_shader, settings_background_color, owner_username \
               FROM vsa_shaders \
               WHERE settings_shader IS NOT NULL \
               AND instr(settings_shader, 'void main') > 0";

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("SHADERS: prepare failed: {e}");
            return (b"[]".to_vec(), 0);
        }
    };

    let mut catalog: Vec<Value> = Vec::new();

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            row.get::<_, Option<i64>>(2)?.unwrap_or(1000),
            row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "POINTS".to_owned()),
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    });

    if let Ok(rows) = rows {
        for row in rows.flatten() {
            let (id, name, num, mode, src, bg_str, author) = row;
            let bg: Value = bg_str
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(Value::Null);
            catalog.push(serde_json::json!({
                "id": id,
                "name": name,
                "num": num.min(100_000),
                "mode": mode,
                "src": src,
                "bg": bg,
                "author": author,
            }));
        }
    }

    let count = catalog.len();
    println!("SHADERS: loaded {count} shaders from {db_path}");
    let json = serde_json::to_vec(&catalog).unwrap_or_else(|_| b"[]".to_vec());
    (json, count)
}
