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

/// Accès à l'index pendant une relecture : un `&mut Index` (tests, outils), ou
/// un `Mutex<Index>` partagé avec l'interface, verrouillé fichier par fichier.
pub trait IndexAccess {
    fn with<R>(&self, f: impl FnOnce(&mut Index) -> Result<R>) -> Result<R>;
}

impl IndexAccess for std::sync::Mutex<Index> {
    fn with<R>(&self, f: impl FnOnce(&mut Index) -> Result<R>) -> Result<R> {
        let mut index = self.lock().map_err(|_| Error::Invalid("Index inutilisable (erreur précédente).".into()))?;
        f(&mut index)
    }
}

impl IndexAccess for std::cell::RefCell<&mut Index> {
    fn with<R>(&self, f: impl FnOnce(&mut Index) -> Result<R>) -> Result<R> {
        f(&mut self.borrow_mut())
    }
}

/// Indexe tous les `.gpx` d'une bibliothèque. Les fichiers inchangés
/// (même taille, même date) ne sont pas relus ; ceux qui ont disparu
/// sortent de l'index.
pub fn scan_library(index: &mut Index, library: &Library, now: i64) -> Result<ScanReport> {
    scan_library_shared(&std::cell::RefCell::new(index), library, now)
}

/// Comme [`scan_library`], mais l'index n'est pris que le temps de chaque
/// fichier : le parcours du dossier (lent sur un NAS) se fait sans lui, et
/// l'interface reste utilisable pendant la relecture.
pub fn scan_library_shared(index: &impl IndexAccess, library: &Library, now: i64) -> Result<ScanReport> {
    // NAS éteint ou débranché : surtout ne rien retirer de l'index (tags, notes,
    // collections seraient perdus). La bibliothèque reste consultable hors ligne.
    if !Path::new(&library.path).is_dir() {
        return Err(Error::Invalid(format!("{} : dossier injoignable ({})", library.name, library.path)));
    }
    let mut report = ScanReport::default();
    let mut seen = HashSet::new();
    let mut walk_failed = false;
    let mut seen_workouts = HashSet::new();
    let mut added: Vec<String> = Vec::new();
    let walker = WalkDir::new(&library.path).follow_links(true).into_iter().filter_entry(|e| {
        e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
    });
    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                walk_failed = true;
                report.errors.push(e.to_string());
                continue;
            }
        };
        let path = entry.path();
        let is_gpx = path.extension().map(|x| x.eq_ignore_ascii_case("gpx")).unwrap_or(false);
        let is_zwo = path.extension().map(|x| x.eq_ignore_ascii_case("zwo")).unwrap_or(false);
        if entry.file_type().is_file() && is_zwo {
            // Entraînement Zwift : indexé à part (onglet Entraînements).
            let key = path.to_string_lossy().to_string();
            seen_workouts.insert(key.clone());
            if let Err(e) = index.with(|i| index_workout(i, library, path, &key, now)) {
                report.errors.push(e.to_string());
            }
            continue;
        }
        if !entry.file_type().is_file() || !is_gpx {
            continue;
        }
        let key = path.to_string_lossy().to_string();
        seen.insert(key.clone());
        match index.with(|i| index_file(i, library, path, &key, now)) {
            Ok(Outcome::Added) => {
                report.added += 1;
                added.push(key.clone());
            }
            Ok(Outcome::Updated) => report.updated += 1,
            Ok(Outcome::Unchanged) => report.unchanged += 1,
            Err(e) => report.errors.push(e.to_string()),
        }
    }
    // Lecture incomplète (dossier illisible, NAS coupé en cours) : on ne retire rien.
    if walk_failed {
        report.errors.push(format!("{} : lecture incomplète, aucune trace retirée de l’index", library.name));
    } else {
        report.removed = index.with(|i| {
            let n = i.remove_missing(library.id, &seen)?;
            i.remove_missing_workouts(library.id, &seen_workouts)?;
            Ok(n)
        })?;
    }
    // Bibliothèque gérée : un fichier déjà rangé dans le dossier d'un sport garde ce
    // sport (nouvelles traces, et une fois pour les traces déjà indexées).
    if library.mode == "managed" {
        index.with(|i| {
            let flag = format!("sports_dossiers_v1_{}", library.id);
            if i.setting(&flag)?.is_none() {
                crate::organize::adopt_folder_sports(i, library, None)?;
                i.set_setting(&flag, "1")?;
            } else if !added.is_empty() {
                let ids: Vec<i64> = added.iter().filter_map(|p| i.trace_id_by_path(p).ok().flatten()).collect();
                crate::organize::adopt_folder_sports(i, library, Some(&ids))?;
            }
            Ok(())
        })?;
    }
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
    let analysis = analyze_file(path).map_err(|e| {
        // Séance Zwift enregistrée en .gpx (ancien bug de numérotation « (2) », corrigé en v0.5.1).
        let head = fs::read(path).map(|b| String::from_utf8_lossy(&b[..b.len().min(4096)]).to_string()).unwrap_or_default();
        if head.contains("<workout_file") {
            Error::Invalid(format!("{} : c'est une séance Zwift (.zwo) enregistrée en .gpx ; renomme-la en .zwo, ou supprime-la si c'est un doublon", path.display()))
        } else {
            e
        }
    })?;
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

/// Renomme une trace. Le nouveau nom reste en place aux relectures ; il est aussi
/// écrit dans le `<name>` du GPX si la bibliothèque l'autorise (renvoie alors
/// `true`). `None` ou un nom vide : retour au nom lu dans le fichier.
/// Dans une bibliothèque gérée, le fichier prendra ce nom au prochain « Ranger ».
pub fn rename_trace(index: &Index, id: i64, name: Option<&str>) -> Result<bool> {
    let (library, path, _, _) = index.trace_file(id)?;
    let p = Path::new(&path);
    let name = name.map(str::trim).filter(|n| !n.is_empty());
    let Some(new) = name else {
        let from_file = analyze_file(p).map(|a| a.name).map_err(|_| {
            Error::Invalid("Fichier injoignable (NAS éteint ?) : impossible de relire son nom.".into())
        })?;
        index.set_name(id, None, &from_file)?;
        return Ok(false);
    };
    index.set_name(id, Some(new), "")?;
    if !library.write_gpx {
        return Ok(false);
    }
    let changed = crate::gpxmeta::write_name_file(p, new)?;
    if changed {
        let meta = fs::metadata(p).map_err(|source| Error::Io { path: p.to_owned(), source })?;
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
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

/// Indexe un entraînement `.zwo` (relu seulement si sa taille ou sa date a changé).
pub(crate) fn index_workout(index: &Index, library: &Library, path: &Path, key: &str, now: i64) -> Result<()> {
    let meta = fs::metadata(path).map_err(|source| Error::Io { path: path.to_owned(), source })?;
    let size = meta.len() as i64;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
    if index.workout_state(key)? == Some((size, mtime)) {
        return Ok(());
    }
    let w = crate::workout::read_zwo(path)?;
    index.upsert_workout(library.id, key, size, mtime, &w, now)?;
    Ok(())
}
