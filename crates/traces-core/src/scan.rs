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
use crate::gpxmeta::read_meta_file;
use crate::index::Index;
use crate::model::{Library, ScanReport, TraceAnalysis};

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

pub(crate) enum Outcome {
    Added,
    Updated,
    Unchanged,
}

pub(crate) fn index_file(index: &mut Index, library: &Library, path: &Path, key: &str, now: i64) -> Result<Outcome> {
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
    let source = source_of(&analysis);
    // Nom connu avant cette lecture (encore avec l'identifiant si la trace date d'avant le nettoyage des noms).
    let old_name = previous.as_ref().and_then(|p| index.get(p.id).ok()).map(|t| t.summary.name);
    let (id, added) = index.upsert_trace(library.id, key, &hash, size, mtime, source, now, &analysis)?;
    // Tags et notes déjà écrits dans le GPX par Organisons : le fichier fait foi.
    if let Some(meta) = read_meta_file(path) {
        index.set_tags(id, &meta.tags)?;
        index.set_notes(id, &meta.notes)?;
    }
    // Identifiant retiré du nom (Openrunner) : ajouté aux notes la première fois
    // seulement (nouvelle trace, ou nom pas encore nettoyé), pour qu'on puisse l'effacer ensuite.
    if let Some(rid) = &analysis.route_id {
        let first_time = added || old_name.is_some_and(|n| n.contains(rid.as_str()));
        let notes = index.get(id)?.notes;
        if first_time && !notes.contains(rid.as_str()) {
            let line = crate::naming::route_id_note(rid, analysis.creator.as_deref());
            let notes = if notes.trim().is_empty() { line } else { format!("{}\n{line}", notes.trim_end()) };
            index.set_notes(id, &notes)?;
        }
    }
    Ok(if added { Outcome::Added } else { Outcome::Updated })
}

/// Origine d'une trace d'après le logiciel qui a créé le GPX.
pub fn source_of(analysis: &TraceAnalysis) -> &'static str {
    match analysis.creator.as_deref().map(str::to_lowercase) {
        Some(c) if c.contains("komoot") => "komoot",
        _ => "local",
    }
}

/// Écrit les tags et notes de l'index dans le GPX de la trace, si sa
/// bibliothèque l'autorise. Renvoie `true` si le fichier a été modifié.
pub fn write_trace_meta(index: &Index, id: i64) -> Result<bool> {
    let (library, path, tags, notes) = index.trace_file(id)?;
    if !library.write_gpx {
        return Ok(false);
    }
    let p = Path::new(&path);
    let changed = crate::gpxmeta::write_meta_file(p, &crate::gpxmeta::GpxMeta { tags, notes })?;
    if changed {
        let meta = fs::metadata(p).map_err(|source| Error::Io { path: p.to_owned(), source })?;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        index.set_file_state(id, &path, &sha256_file(p)?, meta.len() as i64, mtime)?;
    }
    Ok(changed)
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
