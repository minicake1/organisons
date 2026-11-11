//! Sauvegarde de la configuration dans un fichier JSON lisible, à réimporter après
//! une réinstallation, un crash ou sur un autre PC.
//!
//! Le fichier contient ce qu'on ne retrouve pas en relisant les GPX : bibliothèques,
//! réglages, tags (détection, mots-clés), collections et tours, et pour chaque trace
//! le nom et le sport choisis, les tags, les notes, les tags proposés écartés ; plus
//! les doublons écartés, les imports Komoot/Openrunner et les envois au Karoo.
//! **Jamais de secrets** : jetons et clés restent dans le gestionnaire d'identifiants.
//!
//! Les traces sont retrouvées par l'empreinte de leur fichier (SHA-256), puis par leur
//! chemin : une bibliothèque déplacée ou un NAS renommé reste reconnu.

use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::index::Index;

pub const FORMAT: &str = "organisons-sauvegarde";
pub const VERSION: u32 = 1;

/// Réglages internes, recalculés par l'appli : jamais sauvegardés ni restaurés.
fn internal_setting(key: &str) -> bool {
    matches!(key, "analysis_version" | "gpxstudio_sessions" | "inbox_done" | "inbox_since" | "tag_name_in_keywords" | "last_backup" | "ui_prefs")
        || key.starts_with("sports_dossiers_")
}

/// Une trace, telle que la sauvegarde la retrouve.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TraceRef {
    /// Empreinte SHA-256 du fichier.
    pub hash: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBackup {
    pub name: String,
    pub path: String,
    pub mode: String,
    pub pattern: String,
    pub write_gpx: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TagBackup {
    pub name: String,
    pub auto: bool,
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionBackup {
    pub name: String,
    pub is_tour: bool,
    pub created_at: i64,
    /// Dans l'ordre des étapes pour un tour.
    pub traces: Vec<TraceRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraceBackup {
    #[serde(flatten)]
    pub trace: TraceRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sport: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags_ignored: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SendBackup {
    pub service: String,
    pub external_id: String,
    pub sent_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalImportBackup {
    pub source: String,
    pub external_id: String,
    pub path: String,
    pub imported_at: i64,
}

/// Contenu du fichier de sauvegarde.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub format: String,
    pub version: u32,
    /// Version d'Organisons qui a écrit le fichier.
    pub app: String,
    pub created_at: i64,
    pub libraries: Vec<LibraryBackup>,
    pub settings: BTreeMap<String, String>,
    /// Préférences gardées par l'interface (thème, FTP, dossier Zwift).
    #[serde(default)]
    pub ui: BTreeMap<String, String>,
    pub tags: Vec<TagBackup>,
    pub collections: Vec<CollectionBackup>,
    pub traces: Vec<TraceBackup>,
    #[serde(default)]
    pub not_duplicates: Vec<(TraceRef, TraceRef)>,
    #[serde(default)]
    pub external_imports: Vec<ExternalImportBackup>,
    #[serde(default)]
    pub device_sends: Vec<(TraceRef, SendBackup)>,
    /// Envois de séances, par chemin du .zwo.
    #[serde(default)]
    pub workout_sends: Vec<(String, SendBackup)>,
}

fn json_list(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

/// Lit la configuration de l'index.
pub fn export(index: &Index, app: &str, ui: BTreeMap<String, String>, now: i64) -> Result<Backup> {
    let c = &index.conn;
    let libraries = index
        .libraries()?
        .into_iter()
        .map(|l| LibraryBackup { name: l.name, path: l.path, mode: l.mode, pattern: l.pattern, write_gpx: l.write_gpx })
        .collect();
    let mut settings = BTreeMap::new();
    let mut st = c.prepare("SELECT key, value FROM settings ORDER BY key")?;
    for r in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = r?;
        if !internal_setting(&k) {
            settings.insert(k, v);
        }
    }
    let refs: HashMap<i64, TraceRef> = {
        let mut st = c.prepare("SELECT id, file_hash, path FROM traces")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, TraceRef { hash: r.get(1)?, path: r.get(2)? })))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    let r = |id: i64| refs.get(&id).cloned();

    let mut tags = Vec::new();
    let mut st = c.prepare("SELECT tag, auto, keywords FROM tag_names ORDER BY tag")?;
    for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?, r.get::<_, String>(2)?)))? {
        let (name, auto, kw) = row?;
        tags.push(TagBackup { name, auto, keywords: json_list(&kw) });
    }

    let mut collections = Vec::new();
    let mut st = c.prepare("SELECT id, name, is_tour, created_at FROM collections ORDER BY name")?;
    let cols: Vec<(i64, String, bool, i64)> =
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<std::result::Result<_, _>>()?;
    for (id, name, is_tour, created_at) in cols {
        let mut st = c.prepare("SELECT trace_id FROM collection_traces WHERE collection_id = ?1 ORDER BY position, trace_id")?;
        let ids: Vec<i64> = st.query_map([id], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        collections.push(CollectionBackup { name, is_tour, created_at, traces: ids.into_iter().filter_map(r).collect() });
    }

    let mut traces = Vec::new();
    let mut st = c.prepare(
        "SELECT id, name_user, sport_user, notes, tags_ignored,
                (SELECT json_group_array(tag) FROM (SELECT tag FROM tags WHERE trace_id = traces.id ORDER BY tag))
         FROM traces ORDER BY path",
    )?;
    for row in st.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, Option<String>>(5)?,
        ))
    })? {
        let (id, name, sport, notes, ignored, tags) = row?;
        let t = TraceBackup {
            trace: match r(id) {
                Some(t) => t,
                None => continue,
            },
            name,
            sport,
            tags: json_list(&tags.unwrap_or_default()),
            notes,
            tags_ignored: json_list(&ignored),
        };
        let useful = t.name.is_some() || t.sport.is_some() || !t.tags.is_empty() || !t.notes.trim().is_empty() || !t.tags_ignored.is_empty();
        if useful {
            traces.push(t);
        }
    }

    let mut not_duplicates = Vec::new();
    let mut st = c.prepare("SELECT a, b FROM not_duplicates")?;
    for row in st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (a, b) = row?;
        if let (Some(a), Some(b)) = (r(a), r(b)) {
            not_duplicates.push((a, b));
        }
    }

    let mut external_imports = Vec::new();
    let mut st = c.prepare("SELECT source, external_id, path, imported_at FROM external_imports ORDER BY source, external_id")?;
    for row in st.query_map([], |r| {
        Ok(ExternalImportBackup { source: r.get(0)?, external_id: r.get(1)?, path: r.get(2)?, imported_at: r.get(3)? })
    })? {
        external_imports.push(row?);
    }

    let mut device_sends = Vec::new();
    let mut st = c.prepare("SELECT trace_id, service, external_id, sent_at FROM device_sends")?;
    for row in st.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, SendBackup { service: r.get(1)?, external_id: r.get(2)?, sent_at: r.get(3)? }))
    })? {
        let (id, s) = row?;
        if let Some(t) = r(id) {
            device_sends.push((t, s));
        }
    }

    let mut workout_sends = Vec::new();
    let mut st = c.prepare("SELECT w.path, s.service, s.external_id, s.sent_at FROM workout_sends s JOIN workouts w ON w.id = s.workout_id")?;
    for row in st.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, SendBackup { service: r.get(1)?, external_id: r.get(2)?, sent_at: r.get(3)? }))
    })? {
        workout_sends.push(row?);
    }

    Ok(Backup {
        format: FORMAT.into(),
        version: VERSION,
        app: app.into(),
        created_at: now,
        libraries,
        settings,
        ui,
        tags,
        collections,
        traces,
        not_duplicates,
        external_imports,
        device_sends,
        workout_sends,
    })
}

/// Lit un fichier de sauvegarde (et vérifie que c'en est un).
pub fn parse(text: &str) -> Result<Backup> {
    let b: Backup = serde_json::from_str(text).map_err(|e| Error::Invalid(format!("Fichier de sauvegarde illisible : {e}")))?;
    if b.format != FORMAT {
        return Err(Error::Invalid("Ce fichier n'est pas une sauvegarde d'Organisons.".into()));
    }
    if b.version > VERSION {
        return Err(Error::Invalid(format!(
            "Sauvegarde faite par une version plus récente d'Organisons ({}) : mets l'appli à jour pour la restaurer.",
            b.app
        )));
    }
    Ok(b)
}

/// Retrouve les traces de l'index : empreinte, puis chemin.
struct Matcher {
    by_hash: HashMap<String, Vec<(i64, String)>>,
    by_path: HashMap<String, i64>,
}

impl Matcher {
    fn new(index: &Index) -> Result<Self> {
        let mut by_hash: HashMap<String, Vec<(i64, String)>> = HashMap::new();
        let mut by_path = HashMap::new();
        let mut st = index.conn.prepare("SELECT id, file_hash, path FROM traces")?;
        for r in st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
            let (id, h, p) = r?;
            by_path.insert(p.to_lowercase(), id);
            by_hash.entry(h).or_default().push((id, p));
        }
        Ok(Matcher { by_hash, by_path })
    }

    fn find(&self, t: &TraceRef) -> Option<i64> {
        if let Some(list) = self.by_hash.get(&t.hash) {
            // Plusieurs fichiers identiques : celui au même chemin, sinon le premier.
            return list.iter().find(|(_, p)| p.eq_ignore_ascii_case(&t.path)).or(list.first()).map(|(id, _)| *id);
        }
        self.by_path.get(&t.path.to_lowercase()).copied()
    }
}

/// Ce que ferait la restauration, sans rien écrire.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub created_at: i64,
    pub app: String,
    /// Bibliothèques à ajouter (chemin absent de l'index).
    pub libraries_new: Vec<String>,
    /// Bibliothèques déjà là dont le mode, le modèle ou l'écriture changeront.
    pub libraries_changed: Vec<String>,
    /// Bibliothèques à ajouter dont le dossier est injoignable (NAS éteint, autre PC).
    pub libraries_unreachable: Vec<String>,
    pub settings: usize,
    pub tags: usize,
    pub collections: usize,
    pub traces_total: usize,
    /// Traces de la sauvegarde retrouvées dans l'index actuel.
    pub traces_found: usize,
}

pub fn preview(index: &Index, b: &Backup) -> Result<RestorePreview> {
    let current: HashMap<String, crate::model::Library> = index.libraries()?.into_iter().map(|l| (l.path.to_lowercase(), l)).collect();
    let mut p = RestorePreview { created_at: b.created_at, app: b.app.clone(), ..Default::default() };
    for l in &b.libraries {
        match current.get(&l.path.to_lowercase()) {
            None => {
                p.libraries_new.push(l.name.clone());
                if !std::path::Path::new(&l.path).is_dir() {
                    p.libraries_unreachable.push(format!("{} ({})", l.name, l.path));
                }
            }
            Some(c) if c.mode != l.mode || c.pattern != l.pattern || c.write_gpx != l.write_gpx => p.libraries_changed.push(l.name.clone()),
            Some(_) => {}
        }
    }
    let m = Matcher::new(index)?;
    p.settings = b.settings.len();
    p.tags = b.tags.len();
    p.collections = b.collections.len();
    p.traces_total = b.traces.len();
    p.traces_found = b.traces.iter().filter(|t| m.find(&t.trace).is_some()).count();
    Ok(p)
}

/// Bibliothèques de la sauvegarde : ajoutées si absentes, réglages remis sinon.
/// Renvoie les bibliothèques ajoutées (à lire ensuite pour retrouver leurs traces).
pub fn restore_libraries(index: &Index, b: &Backup) -> Result<Vec<crate::model::Library>> {
    let current: HashMap<String, crate::model::Library> = index.libraries()?.into_iter().map(|l| (l.path.to_lowercase(), l)).collect();
    let mut added = Vec::new();
    for l in &b.libraries {
        match current.get(&l.path.to_lowercase()) {
            None => added.push(index.add_library(&l.name, &l.path, &l.mode, &l.pattern, l.write_gpx)?),
            Some(c) => {
                index.conn.execute(
                    "UPDATE libraries SET mode = ?2, pattern = ?3, write_gpx = ?4 WHERE id = ?1",
                    params![c.id, l.mode, l.pattern, l.write_gpx],
                )?;
            }
        }
    }
    Ok(added)
}

/// Bilan d'une restauration.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub libraries_added: usize,
    pub traces_restored: usize,
    /// Traces de la sauvegarde introuvables (fichier supprimé, modifié, ou bibliothèque injoignable).
    pub traces_missing: usize,
    pub collections: usize,
    pub tags: usize,
    pub errors: Vec<String>,
    /// Préférences de l'interface à remettre (thème, FTP, dossier Zwift).
    pub ui: BTreeMap<String, String>,
}

/// Remet réglages, tags, collections et données des traces (à appeler après
/// [`restore_libraries`] et la lecture des bibliothèques ajoutées). Les données de la
/// sauvegarde remplacent celles des traces retrouvées ; rien n'est supprimé d'autre.
/// Les fichiers GPX ne sont pas modifiés.
pub fn restore_data(index: &Index, b: &Backup) -> Result<RestoreReport> {
    let mut rep = RestoreReport { ui: b.ui.clone(), ..Default::default() };
    let m = Matcher::new(index)?;
    let tx = index.conn.unchecked_transaction()?;
    for (k, v) in &b.settings {
        if !internal_setting(k) {
            tx.execute("INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2", params![k, v])?;
        }
    }
    for t in &b.tags {
        tx.execute(
            "INSERT INTO tag_names(tag, auto, keywords) VALUES (?1, ?2, ?3)
             ON CONFLICT(tag) DO UPDATE SET auto = ?2, keywords = ?3",
            params![t.name, t.auto, serde_json::to_string(&t.keywords)?],
        )?;
        rep.tags += 1;
    }
    for t in &b.traces {
        let Some(id) = m.find(&t.trace) else {
            rep.traces_missing += 1;
            continue;
        };
        // Ce que la sauvegarde contient remplace ; le reste de la trace ne change pas.
        let notes = Some(t.notes.as_str()).filter(|n| !n.trim().is_empty());
        let ignored = (!t.tags_ignored.is_empty()).then(|| serde_json::to_string(&t.tags_ignored)).transpose()?;
        tx.execute(
            "UPDATE traces SET name_user = COALESCE(?2, name_user), name = COALESCE(?2, name), sport_user = COALESCE(?3, sport_user),
                    notes = COALESCE(?4, notes), tags_ignored = COALESCE(?5, tags_ignored) WHERE id = ?1",
            params![id, t.name, t.sport, notes, ignored],
        )?;
        if !t.tags.is_empty() {
            tx.execute("DELETE FROM tags WHERE trace_id = ?1", [id])?;
            for tag in &t.tags {
                tx.execute("INSERT OR IGNORE INTO tags(trace_id, tag) VALUES (?1, ?2)", params![id, tag])?;
            }
        }
        rep.traces_restored += 1;
    }
    for c in &b.collections {
        let existing: Option<i64> = tx.query_row("SELECT id FROM collections WHERE name = ?1", [&c.name], |r| r.get(0)).optional()?;
        let cid = match existing {
            Some(id) => {
                tx.execute("UPDATE collections SET is_tour = ?2 WHERE id = ?1", params![id, c.is_tour])?;
                id
            }
            None => {
                tx.execute("INSERT INTO collections(name, created_at, is_tour) VALUES (?1, ?2, ?3)", params![c.name, c.created_at, c.is_tour])?;
                tx.last_insert_rowid()
            }
        };
        let mut seen = HashSet::new();
        for (pos, t) in c.traces.iter().enumerate() {
            if let Some(id) = m.find(t).filter(|id| seen.insert(*id)) {
                tx.execute(
                    "INSERT INTO collection_traces(collection_id, trace_id, position) VALUES (?1, ?2, ?3)
                     ON CONFLICT(collection_id, trace_id) DO UPDATE SET position = ?3",
                    params![cid, id, pos as i64],
                )?;
            }
        }
        rep.collections += 1;
    }
    for (a, bb) in &b.not_duplicates {
        if let (Some(a), Some(bb)) = (m.find(a), m.find(bb)) {
            tx.execute("INSERT OR IGNORE INTO not_duplicates(a, b) VALUES (?1, ?2)", params![a.min(bb), a.max(bb)])?;
        }
    }
    for e in &b.external_imports {
        tx.execute(
            "INSERT OR IGNORE INTO external_imports(source, external_id, path, imported_at) VALUES (?1, ?2, ?3, ?4)",
            params![e.source, e.external_id, e.path, e.imported_at],
        )?;
    }
    for (t, s) in &b.device_sends {
        if let Some(id) = m.find(t) {
            tx.execute(
                "INSERT OR REPLACE INTO device_sends(trace_id, service, external_id, sent_at) VALUES (?1, ?2, ?3, ?4)",
                params![id, s.service, s.external_id, s.sent_at],
            )?;
        }
    }
    for (path, s) in &b.workout_sends {
        let wid: Option<i64> = tx.query_row("SELECT id FROM workouts WHERE path = ?1 COLLATE NOCASE", [path], |r| r.get(0)).optional()?;
        if let Some(wid) = wid {
            tx.execute(
                "INSERT OR REPLACE INTO workout_sends(workout_id, service, external_id, sent_at) VALUES (?1, ?2, ?3, ?4)",
                params![wid, s.service, s.external_id, s.sent_at],
            )?;
        }
    }
    tx.commit()?;
    Ok(rep)
}

/// Nom du fichier d'une sauvegarde : `organisons-sauvegarde-AAAA-MM-JJ-HHMM.json`.
pub fn file_name(now: i64) -> String {
    let d = time::OffsetDateTime::from_unix_timestamp(now).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    format!("organisons-sauvegarde-{:04}-{:02}-{:02}-{:02}{:02}.json", d.year(), d.month() as u8, d.day(), d.hour(), d.minute())
}

/// Écrit une sauvegarde dans un dossier (automatique), en gardant les `keep` plus récentes.
pub fn write_to_dir(dir: &std::path::Path, b: &Backup, keep: usize) -> Result<std::path::PathBuf> {
    std::fs::create_dir_all(dir).map_err(|source| Error::Io { path: dir.to_owned(), source })?;
    let path = dir.join(file_name(b.created_at));
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(b)?).map_err(|source| Error::Io { path: tmp.clone(), source })?;
    std::fs::rename(&tmp, &path).map_err(|source| Error::Io { path: path.clone(), source })?;
    // Rotation : seulement nos fichiers, les plus anciens d'abord.
    let mut ours: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    n.starts_with("organisons-sauvegarde-") && n.ends_with(".json")
                })
                .collect()
        })
        .unwrap_or_default();
    ours.sort();
    if ours.len() > keep.max(1) {
        for old in &ours[..ours.len() - keep.max(1)] {
            let _ = std::fs::remove_file(old);
        }
    }
    Ok(path)
}
