use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub media_types: Option<String>,
    pub media_type: Option<Vec<String>>,
    pub db_file: String,
    pub scan_roots: Vec<String>,
    pub steam_dir: Option<String>,
}

impl Config {
    pub fn extensions(&self) -> Vec<String> {
        if let Some(list) = &self.media_type {
            return list
                .iter()
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .collect();
        }
        self.media_types
            .as_deref()
            .unwrap_or("mp3")
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    }
}

fn expand_env(s: &str) -> String {
    let mut result = s.to_string();
    for (key, val) in std::env::vars() {
        result = result.replace(&format!("${key}"), &val);
    }
    result
}

pub fn load_config(path: &str) -> Config {
    if !Path::new(path).exists() {
        eprintln!("ERROR: config file not found: {path}");
        std::process::exit(3);
    }
    let text = fs::read_to_string(path).unwrap_or_else(|e| {
        eprintln!("ERROR: failed to read config {path}: {e}");
        std::process::exit(3);
    });
    let mut cfg: Config = serde_yaml::from_str(&text).unwrap_or_else(|e| {
        eprintln!("ERROR: failed to parse config {path}: {e}");
        std::process::exit(3);
    });
    cfg.scan_roots = cfg.scan_roots.iter()
        .map(|r| expand_env(r).trim_end_matches(['/', '\\']).to_owned())
        .collect();
    cfg
}
