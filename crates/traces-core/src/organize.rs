//! Rangement des bibliothèques gérées selon un modèle de chemin
//! (`{sport}/{annee}/{nom}.gpx` par défaut).
//!
//! Rien ne bouge sans validation : [`plan`] calcule les déplacements, que
//! l'interface affiche, puis [`apply`] les exécute. [`import_files`] copie de
//! nouveaux fichiers directement à leur place.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::analyze::analyze_file;
use crate::error::Result;
use crate::index::Index;
use crate::model::{Library, OrganizeReport, PlannedMove, SetAsideInfo};
use crate::scan;
use crate::sport::sport_for;

/// Année et mois (UTC) d'une date Unix.
fn year_month(ts: i64) -> (i32, u8) {
    time::OffsetDateTime::from_unix_timestamp(ts).map(|d| (d.year(), d.month() as u8)).unwrap_or((1970, 1))
}

/// Valeurs disponibles dans le modèle de chemin.
#[derive(Debug, Clone)]
pub struct PathVars<'a> {
    pub name: &'a str,
    pub sport: &'a str,
    /// secondes Unix
    pub date: i64,
    /// "local" ou "komoot"
    pub source: &'a str,
    pub collection: Option<&'a str>,
}

fn source_label(source: &str) -> &str {
    match source {
        "komoot" => "Komoot",
        "local" => "Local",
        other => other,
    }
}

/// Rend un nom utilisable comme nom de fichier sous Windows, sur un NAS et sous Linux.
pub fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect();
    let mut s = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    s = s.trim_end_matches(['.', ' ']).to_string();
    if s.chars().count() > 120 {
        s = s.chars().take(120).collect::<String>().trim_end_matches(['.', ' ']).to_string();
    }
    if s.is_empty() {
        s = "Sans nom".into();
    }
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1",
        "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(&s)) {
        s.push('_');
    }
    s
}

/// Chemin voulu pour une trace, d'après le modèle de la bibliothèque.
/// Variables : `{sport}`, `{annee}` (ou `{année}`), `{mois}`, `{source}`,
/// `{collection}` (« Sans collection » à défaut) et `{nom}` (nettoyé, voir [`crate::naming`]).
/// L’année et le mois viennent de la date du titre s’il y en a une.
pub fn target_path(library: &Library, v: &PathVars) -> PathBuf {
    let pattern = if library.pattern.trim().is_empty() { "{sport}/{annee}/{nom}.gpx" } else { &library.pattern };
    // La date écrite dans le titre prime : l’heure des points d’un export Openrunner est celle de l’export.
    let date = crate::naming::date_in_name(v.name).and_then(|d| d.timestamp()).unwrap_or(v.date);
    let (year, month) = year_month(date);
    let mut path = PathBuf::from(&library.path);
    for part in pattern.split(['/', '\\']).filter(|p| !p.is_empty()) {
        let rendered = part
            .replace("{sport}", &sanitize(v.sport))
            .replace("{annee}", &year.to_string())
            .replace("{année}", &year.to_string())
            .replace("{mois}", &format!("{month:02}"))
            .replace("{source}", &sanitize(source_label(v.source)))
            .replace("{collection}", &sanitize(v.collection.unwrap_or("Sans collection")))
            .replace("{nom}", &sanitize(&crate::naming::clean_name(v.name)));
        path.push(rendered);
    }
    if path.extension().map(|e| !e.eq_ignore_ascii_case("gpx")).unwrap_or(true) {
        let file = path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        path.set_file_name(format!("{file}.gpx"));
    }
    path
}

/// Clé de comparaison : Windows et les partages NAS ignorent la casse.
fn key(p: &Path) -> String {
    p.to_string_lossy().replace('/', "\\").to_lowercase()
}

/// Ajoute « (2) », « (3) »… si le chemin est déjà pris sur le disque ou dans le plan.
fn unique(path: PathBuf, taken: &HashSet<String>) -> PathBuf {
    if !path.exists() && !taken.contains(&key(&path)) {
        return path;
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    for n in 2.. {
        let candidate = path.with_file_name(format!("{stem} ({n}).gpx"));
        if !candidate.exists() && !taken.contains(&key(&candidate)) {
            return candidate;
        }
    }
    unreachable!()
}

/// Déplacements nécessaires pour ranger la bibliothèque (aucun fichier n'est touché).
pub fn plan(index: &Index, library: &Library) -> Result<Vec<PlannedMove>> {
    let rows = index.organize_rows(library.id)?;
    // Les fichiers déjà bien rangés gardent leur place.
    let mut taken: HashSet<String> = HashSet::new();
    let mut todo = Vec::new();
    for r in rows {
        let wanted = target_path(
            library,
            &PathVars {
                name: &r.name,
                sport: &r.sport,
                date: r.date,
                source: &r.source,
                collection: r.collection.as_deref(),
            },
        );
        if key(&wanted) == key(Path::new(&r.path)) {
            taken.insert(key(&wanted));
        } else {
            todo.push((r.id, r.path, r.name, wanted));
        }
    }
    let mut moves = Vec::new();
    for (id, from, name, wanted) in todo {
        // Un fichier déjà numéroté « (2) » au bon endroit n'a pas à bouger.
        let from_path = Path::new(&from);
        let same_dir = from_path.parent().map(key) == wanted.parent().map(key);
        let stem = wanted.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let from_stem = from_path.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        if same_dir && from_stem.starts_with(&format!("{stem} (")) && from_stem.ends_with(')') {
            taken.insert(key(from_path));
            continue;
        }
        let to = unique(wanted, &taken);
        taken.insert(key(&to));
        moves.push(PlannedMove { trace_id: id, name, from, to: to.to_string_lossy().to_string() });
    }
    Ok(moves)
}

/// Exécute les déplacements validés. Chaque déplacement est revérifié juste
/// avant : un fichier modifié ou une destination occupée entre-temps est ignoré.
pub fn apply(index: &Index, library: &Library, moves: &[PlannedMove]) -> Result<OrganizeReport> {
    let mut report = OrganizeReport::default();
    let root = PathBuf::from(&library.path);
    for m in moves {
        let (from, to) = (Path::new(&m.from), Path::new(&m.to));
        if index.trace_id_by_path(&m.from)? != Some(m.trace_id) {
            report.errors.push(format!("{} : la trace a changé depuis l'aperçu, ignorée", m.name));
            continue;
        }
        if !to.starts_with(&root) {
            report.errors.push(format!("{} : destination hors de la bibliothèque, ignorée", m.name));
            continue;
        }
        if !from.exists() {
            report.errors.push(format!("{} : fichier introuvable ({})", m.name, m.from));
            continue;
        }
        if to.exists() {
            report.errors.push(format!("{} : la destination existe déjà ({})", m.name, m.to));
            continue;
        }
        if let Some(dir) = to.parent() {
            if let Err(e) = fs::create_dir_all(dir) {
                report.errors.push(format!("{} : création de {} impossible ({e})", m.name, dir.display()));
                continue;
            }
        }
        match fs::rename(from, to) {
            Ok(()) => {
                index.set_path(m.trace_id, &m.to)?;
                report.moved += 1;
                remove_empty_dirs(from.parent(), &root);
            }
            Err(e) => report.errors.push(format!("{} : déplacement impossible ({e})", m.name)),
        }
    }
    Ok(report)
}

/// Supprime les dossiers devenus vides, en remontant jusqu'à la racine (exclue).
fn remove_empty_dirs(mut dir: Option<&Path>, root: &Path) {
    while let Some(d) = dir {
        if d == root || !d.starts_with(root) {
            break;
        }
        let empty = fs::read_dir(d).map(|mut it| it.next().is_none()).unwrap_or(false);
        if !empty || fs::remove_dir(d).is_err() {
            break;
        }
        dir = d.parent();
    }
}

/// Dossier caché où sont mis de côté les doublons (ignoré par la relecture).
pub const SET_ASIDE_DIR: &str = ".organisons-doublons";
/// Corbeille d’Organisons : traces supprimées, récupérables jusqu’au vidage.
pub const TRASH_DIR: &str = ".organisons-corbeille";

fn ymd(ts: i64) -> String {
    let d = time::OffsetDateTime::from_unix_timestamp(ts).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    format!("{:04}-{:02}-{:02}", d.year(), d.month() as u8, d.day())
}

/// Date de mise de côté : préfixe « AAAA-MM-JJ » du nom, sinon date du fichier.
fn set_aside_at(path: &Path) -> Option<i64> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let prefix = name.get(..10).filter(|p| p.as_bytes().get(4) == Some(&b'-') && p.as_bytes().get(7) == Some(&b'-'));
    if let Some(p) = prefix {
        let (y, m, d) = (p[..4].parse().ok()?, p[5..7].parse::<u8>().ok()?, p[8..10].parse().ok()?);
        let date = time::Date::from_calendar_date(y, time::Month::try_from(m).ok()?, d).ok()?;
        return Some(date.midnight().assume_utc().unix_timestamp());
    }
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64)
}

/// Fichiers d’un dossier de côté (doublons ou corbeille) dans toutes les bibliothèques : (chemin, date, taille).
fn aside_files(index: &Index, dir_name: &str) -> Result<Vec<(PathBuf, i64, u64)>> {
    let mut out = Vec::new();
    for lib in index.libraries()? {
        let dir = PathBuf::from(&lib.path).join(dir_name);
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                out.push((p.clone(), set_aside_at(&p).unwrap_or(0), size));
            }
        }
    }
    Ok(out)
}

/// Contenu des dossiers `.organisons-doublons`.
pub fn set_aside_info(index: &Index) -> Result<SetAsideInfo> {
    aside_info(index, SET_ASIDE_DIR)
}

/// Contenu des corbeilles `.organisons-corbeille`.
pub fn trash_info(index: &Index) -> Result<SetAsideInfo> {
    aside_info(index, TRASH_DIR)
}

fn aside_info(index: &Index, dir_name: &str) -> Result<SetAsideInfo> {
    let files = aside_files(index, dir_name)?;
    Ok(SetAsideInfo {
        count: files.len(),
        bytes: files.iter().map(|f| f.2).sum(),
        oldest: files.iter().map(|f| f.1).filter(|&d| d > 0).min(),
    })
}

/// Supprime définitivement les doublons mis de côté : tous (`older_than_days`
/// à `None`) ou ceux mis de côté depuis plus de N jours. Seuls les fichiers des
/// dossiers `.organisons-doublons` sont touchés. Renvoie le nombre supprimé.
pub fn purge_set_aside(index: &Index, now: i64, older_than_days: Option<u32>) -> Result<usize> {
    purge_aside(index, now, older_than_days, SET_ASIDE_DIR)
}

/// Vide la corbeille d'Organisons (tout, ou ce qui y est depuis plus de N jours).
pub fn purge_trash(index: &Index, now: i64, older_than_days: Option<u32>) -> Result<usize> {
    purge_aside(index, now, older_than_days, TRASH_DIR)
}

fn purge_aside(index: &Index, now: i64, older_than_days: Option<u32>, dir_name: &str) -> Result<usize> {
    let mut removed = 0;
    let mut dirs = HashSet::new();
    for (path, at, _) in aside_files(index, dir_name)? {
        let old_enough = match older_than_days {
            None => true,
            Some(days) => at > 0 && now - at >= i64::from(days) * 86_400,
        };
        // Garde-fou : uniquement dans le dossier attendu (.organisons-doublons ou .organisons-corbeille).
        let parent_ok = path.parent().and_then(|p| p.file_name()).map(|n| n == dir_name).unwrap_or(false);
        if old_enough && parent_ok && fs::remove_file(&path).is_ok() {
            removed += 1;
            if let Some(p) = path.parent() {
                dirs.insert(p.to_path_buf());
            }
        }
    }
    for d in dirs {
        if fs::read_dir(&d).map(|mut it| it.next().is_none()).unwrap_or(false) {
            let _ = fs::remove_dir(&d);
        }
    }
    Ok(removed)
}

/// Met un doublon de côté : le fichier est déplacé dans le dossier caché
/// `.organisons-doublons` à la racine de sa bibliothèque, préfixé par la date
/// du jour (rien n'est supprimé), et la trace sort de l'index. Renvoie le
/// nouveau chemin du fichier.
pub fn set_aside(index: &Index, trace_id: i64, now: i64) -> Result<String> {
    move_aside(index, trace_id, now, SET_ASIDE_DIR)
}

/// Met une trace à la corbeille d'Organisons : son GPX est déplacé dans
/// `.organisons-corbeille` à la racine de sa bibliothèque (récupérable jusqu'au
/// vidage) et la trace sort de l'index. Renvoie le nouveau chemin du fichier.
pub fn trash_trace(index: &Index, trace_id: i64, now: i64) -> Result<String> {
    move_aside(index, trace_id, now, TRASH_DIR)
}

fn move_aside(index: &Index, trace_id: i64, now: i64, dir_name: &str) -> Result<String> {
    let (library, path, _, _) = index.trace_file(trace_id)?;
    let from = PathBuf::from(&path);
    let root = PathBuf::from(&library.path);
    let base = from.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| "trace.gpx".into());
    let file = format!("{} {base}", ymd(now));
    let dir = root.join(dir_name);
    fs::create_dir_all(&dir).map_err(|source| crate::Error::Io { path: dir.clone(), source })?;
    let to = unique(dir.join(&file), &HashSet::new());
    fs::rename(&from, &to).map_err(|source| crate::Error::Io { path: from.clone(), source })?;
    index.remove_trace(trace_id)?;
    remove_empty_dirs(from.parent(), &root);
    Ok(to.to_string_lossy().to_string())
}

/// Copie des GPX dans une bibliothèque gérée, directement à leur place, puis
/// les indexe. Les fichiers d'origine ne sont pas touchés.
pub fn import_files(index: &mut Index, library: &Library, files: &[String], now: i64) -> Result<OrganizeReport> {
    let mut report = OrganizeReport::default();
    let taken = HashSet::new();
    for src in files {
        let src_path = Path::new(src);
        let analysis = match analyze_file(src_path) {
            Ok(a) => a,
            Err(e) => {
                report.errors.push(e.to_string());
                continue;
            }
        };
        let mtime = fs::metadata(src_path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(now);
        let sport = sport_for(analysis.sport_type.as_deref(), &analysis.name);
        let source = scan::source_of(&analysis);
        let vars = PathVars {
            name: &analysis.name,
            sport,
            date: analysis.date.unwrap_or(mtime),
            source,
            collection: None,
        };
        let to = unique(target_path(library, &vars), &taken);
        if let Some(dir) = to.parent() {
            if let Err(e) = fs::create_dir_all(dir) {
                report.errors.push(format!("{} : création de {} impossible ({e})", analysis.name, dir.display()));
                continue;
            }
        }
        if let Err(e) = fs::copy(src_path, &to) {
            report.errors.push(format!("{} : copie impossible ({e})", analysis.name));
            continue;
        }
        match scan::index_file(index, library, &to, &to.to_string_lossy(), now) {
            Ok(_) => {
                report.imported += 1;
                if let Some(id) = index.trace_id_by_path(&to.to_string_lossy())? {
                    report.imported_ids.push(id);
                }
            }
            Err(e) => report.errors.push(e.to_string()),
        }
    }
    Ok(report)
}

/// Nom d'origine d'un fichier mis à la corbeille : sans le préfixe « AAAA-MM-JJ ».
fn original_name(file: &str) -> String {
    let b = file.as_bytes();
    if b.len() > 11 && b[4] == b'-' && b[7] == b'-' && b[10] == b' ' && file[..4].chars().all(|c| c.is_ascii_digit()) {
        file[11..].to_string()
    } else {
        file.to_string()
    }
}

/// Contenu de la corbeille, le plus récent d’abord.
pub fn trash_list(index: &Index) -> Result<Vec<crate::model::TrashItem>> {
    aside_list(index, TRASH_DIR)
}

/// Doublons mis de côté (`.organisons-doublons`), le plus récent d’abord.
pub fn set_aside_list(index: &Index) -> Result<Vec<crate::model::TrashItem>> {
    aside_list(index, SET_ASIDE_DIR)
}

/// Fichiers d’un dossier de côté (corbeille ou doublons) de toutes les bibliothèques.
fn aside_list(index: &Index, dir_name: &str) -> Result<Vec<crate::model::TrashItem>> {
    let mut out = Vec::new();
    for lib in index.libraries()? {
        let dir = PathBuf::from(&lib.path).join(dir_name);
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            if !p.is_file() {
                continue;
            }
            let file = p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            let original = original_name(&file);
            let name = analyze_file(&p).map(|a| a.name).unwrap_or_else(|_| {
                Path::new(&original).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or(original.clone())
            });
            out.push(crate::model::TrashItem {
                path: p.to_string_lossy().to_string(),
                name,
                file: original,
                library_id: lib.id,
                library: lib.name.clone(),
                deleted_at: set_aside_at(&p).unwrap_or(0),
                bytes: e.metadata().map(|m| m.len()).unwrap_or(0),
            });
        }
    }
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at).then(a.name.cmp(&b.name)));
    Ok(out)
}

/// Restaure un fichier de la corbeille ou des doublons mis de côté : il revient à la racine de sa
/// bibliothèque sous son nom d'origine (« Ranger » le remettra à sa place) et
/// la trace est de nouveau indexée. Renvoie l'identifiant de la trace.
pub fn restore_from_trash(index: &mut Index, path: &str, now: i64) -> Result<i64> {
    let from = PathBuf::from(path);
    // Garde-fou : uniquement un fichier d'une corbeille de bibliothèque connue.
    let lib = index
        .libraries()?
        .into_iter()
        .find(|l| {
            let root = PathBuf::from(&l.path);
            from.parent() == Some(root.join(TRASH_DIR).as_path()) || from.parent() == Some(root.join(SET_ASIDE_DIR).as_path())
        })
        .ok_or_else(|| crate::Error::Invalid("Ce fichier n'est ni dans une corbeille ni dans les doublons mis de côté d'Organisons.".into()))?;
    let root = PathBuf::from(&lib.path);
    let file = from.file_name().map(|f| original_name(&f.to_string_lossy())).unwrap_or_else(|| "trace.gpx".into());
    let to = unique(root.join(file), &HashSet::new());
    fs::rename(&from, &to).map_err(|source| crate::Error::Io { path: from.clone(), source })?;
    remove_empty_dirs(from.parent(), &root);
    let key = to.to_string_lossy().to_string();
    scan::index_file(index, &lib, &to, &key, now)?;
    index.trace_id_by_path(&key)?.ok_or_else(|| crate::Error::NotFound(key))
}

/// Compare des fichiers à importer avec l'index, sans rien copier : même fichier
/// déjà présent (empreinte), ou même parcours probable (critères des Doublons).
pub fn check_import(index: &Index, files: &[String]) -> Result<Vec<crate::model::ImportCheck>> {
    use crate::index::{similar_routes, RouteKey};
    let existing = index.list(&crate::model::TraceFilter::default())?;
    let mut out = Vec::new();
    for file in files {
        let path = Path::new(file);
        let fallback = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let analysis = match analyze_file(path) {
            Ok(a) => a,
            Err(e) => {
                out.push(crate::model::ImportCheck {
                    file: file.clone(),
                    name: fallback,
                    status: "error".into(),
                    matches: vec![],
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        let same_file = index.names_by_hash(&scan::sha256_file(path)?)?;
        let key = RouteKey {
            distance_km: analysis.distance_km,
            elevation_gain: analysis.elevation_gain,
            start: analysis.profile.first().map(|p| [p.lat, p.lon]),
            end: analysis.profile.last().map(|p| [p.lat, p.lon]),
        };
        let (status, matches) = if !same_file.is_empty() {
            ("identical", same_file)
        } else {
            let similar: Vec<String> =
                existing.iter().filter(|t| similar_routes(&key, &RouteKey::of(t))).map(|t| t.name.clone()).collect();
            if similar.is_empty() { ("new", similar) } else { ("probable", similar) }
        };
        out.push(crate::model::ImportCheck {
            file: file.clone(),
            name: analysis.name,
            status: status.into(),
            matches,
            error: None,
        });
    }
    Ok(out)
}

/// Modèle de rangement par défaut.
pub const DEFAULT_PATTERN: &str = "{sport}/{annee}/{nom}.gpx";
const PATTERN_VARS: [&str; 7] = ["{sport}", "{annee}", "{année}", "{mois}", "{source}", "{collection}", "{nom}"];

/// Vérifie un modèle de rangement saisi dans les Réglages : chemin relatif à la
/// bibliothèque, variables connues, `{nom}` dans le nom du fichier.
pub fn validate_pattern(pattern: &str) -> Result<()> {
    let p = pattern.trim();
    let bad = |m: &str| Err(crate::Error::Invalid(m.to_string()));
    if p.is_empty() {
        return bad("Le modèle est vide.");
    }
    if p.starts_with(['/', '\\']) || p.contains(':') {
        return bad("Le modèle doit être un chemin relatif à la bibliothèque (sans lecteur ni « / » au début).");
    }
    let parts: Vec<&str> = p.split(['/', '\\']).collect();
    if parts.iter().any(|s| s.trim().is_empty() || *s == "." || *s == "..") {
        return bad("Le modèle contient un dossier vide, « . » ou « .. ».");
    }
    let mut rest = p.to_string();
    for v in PATTERN_VARS {
        rest = rest.replace(v, "");
    }
    if let Some(i) = rest.find('{') {
        let unknown: String = rest[i..].chars().take_while(|c| *c != '}').chain(['}']).collect();
        return bad(&format!("Variable inconnue : {unknown}"));
    }
    if rest.contains('}') {
        return bad("Accolade « } » sans « { ».");
    }
    if !parts.last().is_some_and(|f| f.contains("{nom}")) {
        return bad("Le nom du fichier (dernière partie) doit contenir {nom}.");
    }
    Ok(())
}

/// Exemple de chemin produit par un modèle (relatif à la bibliothèque), pour les Réglages.
pub fn pattern_example(pattern: &str) -> Result<String> {
    validate_pattern(pattern)?;
    let lib = Library {
        id: 0,
        name: String::new(),
        path: String::new(),
        mode: "managed".into(),
        pattern: pattern.trim().to_string(),
        write_gpx: false,
    };
    // 27 août 2022
    let v = PathVars { name: "Le Mythique SBC SPIDER", sport: "Gravel", date: 1_661_601_600, source: "local", collection: Some("Sorties club") };
    Ok(target_path(&lib, &v).to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lib(path: &str) -> Library {
        Library {
            id: 1,
            name: "NAS".into(),
            path: path.into(),
            mode: "managed".into(),
            pattern: "{sport}/{annee}/{nom}.gpx".into(),
            write_gpx: true,
        }
    }

    #[test]
    fn noms_de_fichiers() {
        assert_eq!(sanitize("BRM 600 : Tour/Manche?"), "BRM 600 Tour Manche");
        assert_eq!(sanitize("  ...  "), "Sans nom");
        assert_eq!(sanitize("con"), "con_");
        assert_eq!(sanitize("Fin."), "Fin");
    }

    #[test]
    fn modeles_de_rangement() {
        assert!(validate_pattern(DEFAULT_PATTERN).is_ok());
        assert!(validate_pattern("{source}/{collection}/{année}-{mois} {nom}").is_ok());
        assert!(validate_pattern("").is_err());
        assert!(validate_pattern("C:/gpx/{nom}").is_err());
        assert!(validate_pattern("../{nom}.gpx").is_err());
        assert!(validate_pattern("{sport}/{nom}/fichier.gpx").is_err(), "{{nom}} doit être dans le nom du fichier");
        let e = validate_pattern("{sport}/{ville}/{nom}").unwrap_err().to_string();
        assert!(e.contains("{ville}"), "{e}");
        assert_eq!(pattern_example(DEFAULT_PATTERN).unwrap(), "Gravel/2022/Le Mythique SBC SPIDER.gpx");
        assert_eq!(pattern_example("{annee}/{mois} {nom}").unwrap(), "2022/08 Le Mythique SBC SPIDER.gpx");
    }

    #[test]
    fn chemin_cible() {
        // 2026-05-01 UTC
        let v = PathVars { name: "Boucle : Vexin", sport: "Route", date: 1_777_593_600, source: "komoot", collection: None };
        let p = target_path(&lib("/nas/gpx"), &v);
        assert_eq!(p, PathBuf::from("/nas/gpx").join("Route").join("2026").join("Boucle Vexin.gpx"));
        let mut l = lib("/nas/gpx");
        l.pattern = "{source}/{collection}/{annee}-{mois} {nom}".into();
        let p = target_path(&l, &PathVars { collection: Some("BRM 2027"), ..v });
        assert_eq!(p, PathBuf::from("/nas/gpx").join("Komoot").join("BRM 2027").join("2026-05 Boucle Vexin.gpx"));
    }
}
