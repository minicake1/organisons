//! Parcours d'un dossier de bibliothèque et mise à jour de l'index.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::analyze::analyze_file;
use crate::error::{Error, Result};
use crate::index::Index;
use crate::model::{Library, ScanReport};

/// Indexe tous les `.gpx` d'une bibliothèque. Les fichiers inchangés
/// (même taille, même date) ne sont pas relus ; ceux qui ont disparu
/// sortent de l'index.
pub fn scan_library(index: &mut Index, library: &Library, now: i64) -> Result<ScanReport> {
    let mut report = ScanReport::default();
    let mut seen = HashSet::new();
    let walker = WalkDir::new(&library.path).follow_links(true).into_iter().filter_entry(|e| {
        e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
    });
    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                report.errors.push(e.to_string());
                continue;
            }
        };
        let path = entry.path();
        let is_gpx = path.extension().map(|x| x.eq_ignore_ascii_case("gpx")).unwrap_or(false);
        if !entry.file_type().is_file() || !is_gpx {
            continue;
        }
        let key = path.to_string_lossy().to_string();
        seen.insert(key.clone());
        match index_file(index, library, path, &key, now) {
            Ok(Outcome::Added) => report.added += 1,
            Ok(Outcome::Updated) => report.updated += 1,
            Ok(Outcome::Unchanged) => report.unchanged += 1,
            Err(e) => report.errors.push(e.to_string()),
        }
    }
    report.removed = index.remove_missing(library.id, &seen)?;
    Ok(report)
}

enum Outcome {
    Added,
    Updated,
    Unchanged,
}

fn index_file(index: &mut Index, library: &Library, path: &Path, key: &str, now: i64) -> Result<Outcome> {
    let meta = fs::metadata(path).map_err(|source| Error::Io { path: path.to_owned(), source })?;
    let size = meta.len() as i64;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let previous = index.file_state(key)?;
    if let Some(prev) = &previous {
        if prev.size == size && prev.mtime == mtime {
            return Ok(Outcome::Unchanged);
        }
    }
    let hash = sha256_file(path)?;
    if let Some(prev) = &previous {
        if prev.hash == hash {
            return Ok(Outcome::Unchanged);
        }
    }
    let analysis = analyze_file(path)?;
    let source = match analysis.creator.as_deref().map(str::to_lowercase) {
        Some(c) if c.contains("komoot") => "komoot",
        _ => "local",
    };
    let (_, added) = index.upsert_trace(library.id, key, &hash, size, mtime, source, now, &analysis)?;
    Ok(if added { Outcome::Added } else { Outcome::Updated })
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = fs::File::open(path).map_err(|source| Error::Io { path: path.to_owned(), source })?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|source| Error::Io { path: path.to_owned(), source })?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}
