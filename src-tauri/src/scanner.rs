use rayon::prelude::*;
use std::path::PathBuf;
use walkdir::WalkDir;

pub fn scan_all(roots: &[String], extensions: &[String]) -> Vec<(PathBuf, String)> {
    roots
        .par_iter()
        .flat_map(|root| {
            if !std::path::Path::new(root).exists() {
                eprintln!("SCANNER: WARNING: scan root does not exist, skipping: {root}");
                return vec![];
            }
            println!("SCANNER: Scanning {root}");
            scan_directory(root, extensions)
                .into_iter()
                .map(|p| (p, root.clone()))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn scan_directory(dir: &str, extensions: &[String]) -> Vec<PathBuf> {
    WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| extensions.contains(&ext.to_string_lossy().to_lowercase()))
                .unwrap_or(false)
        })
        .map(|e| e.into_path())
        .collect()
}
