//! Index SQLite local : bibliothèques, traces, tags, points d'intérêt.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{Error, Result};
use crate::model::*;

/// Version des règles d’analyse : la changer fait relire tous les fichiers une fois.
const ANALYSIS_VERSION: &str = "7";

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS libraries (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    path     TEXT NOT NULL UNIQUE,
    mode     TEXT NOT NULL DEFAULT 'index',
    pattern  TEXT NOT NULL DEFAULT '{sport}/{annee}/{nom}.gpx'
);
CREATE TABLE IF NOT EXISTS traces (
    id             INTEGER PRIMARY KEY,
    library_id     INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    path           TEXT NOT NULL UNIQUE,
    file_hash      TEXT NOT NULL,
    file_size      INTEGER NOT NULL,
    file_mtime     INTEGER NOT NULL,
    name           TEXT NOT NULL,
    distance_km    REAL NOT NULL,
    elevation_gain REAL NOT NULL,
    elevation_loss REAL NOT NULL,
    ele_min        REAL NOT NULL,
    ele_max        REAL NOT NULL,
    hilliness      TEXT NOT NULL,
    wind           TEXT NOT NULL,
    surface_type   TEXT,
    source         TEXT NOT NULL DEFAULT 'local',
    start_lat      REAL NOT NULL,
    start_lon      REAL NOT NULL,
    bbox_json      TEXT NOT NULL,
    point_count    INTEGER NOT NULL,
    has_time       INTEGER NOT NULL,
    creator        TEXT,
    notes          TEXT NOT NULL DEFAULT '',
    added_at       INTEGER NOT NULL,
    preview_json   TEXT NOT NULL,
    profile_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS traces_hash ON traces(file_hash);
CREATE TABLE IF NOT EXISTS tags (
    trace_id INTEGER NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    tag      TEXT NOT NULL,
    PRIMARY KEY (trace_id, tag)
);
CREATE TABLE IF NOT EXISTS pois (
    trace_id INTEGER NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    idx      INTEGER NOT NULL,
    name     TEXT NOT NULL,
    kind     TEXT NOT NULL,
    km       REAL NOT NULL,
    lat      REAL NOT NULL,
    lon      REAL NOT NULL,
    symbol   TEXT,
    PRIMARY KEY (trace_id, idx)
);
CREATE TABLE IF NOT EXISTS collections (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_traces (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    trace_id      INTEGER NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, trace_id)
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- Paires de traces que l'utilisateur a déclarées « pas des doublons » (a < b).
-- Entraînements envoyés vers un compteur (identifiant chez le service).
CREATE TABLE IF NOT EXISTS workout_sends (
    workout_id  INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    service     TEXT NOT NULL,
    external_id TEXT NOT NULL,
    sent_at     INTEGER NOT NULL,
    PRIMARY KEY (workout_id, service)
);
-- Entraînements (.zwo) trouvés dans les bibliothèques.
CREATE TABLE IF NOT EXISTS workouts (
    id          INTEGER PRIMARY KEY,
    library_id  INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    path        TEXT NOT NULL UNIQUE,
    file_size   INTEGER NOT NULL,
    file_mtime  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    author      TEXT NOT NULL,
    description TEXT NOT NULL,
    sport       TEXT NOT NULL,
    tags_json   TEXT NOT NULL,
    duration    INTEGER NOT NULL,
    intensity   REAL NOT NULL,
    tss         REAL NOT NULL,
    blocks_json TEXT NOT NULL,
    added_at    INTEGER NOT NULL
);
-- Parcours envoyés vers un compteur (Hammerhead…) : identifiant chez le service, pour mettre à jour.
CREATE TABLE IF NOT EXISTS device_sends (
    trace_id    INTEGER NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    service     TEXT NOT NULL,
    external_id TEXT NOT NULL,
    sent_at     INTEGER NOT NULL,
    PRIMARY KEY (trace_id, service)
);
-- Parcours déjà importés depuis un service (Komoot…), pour ne pas les reprendre.
CREATE TABLE IF NOT EXISTS external_imports (
    source      TEXT NOT NULL,
    external_id TEXT NOT NULL,
    path        TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    PRIMARY KEY (source, external_id)
);
-- Tags créés depuis l’onglet Tags, pas encore posés sur une trace.
CREATE TABLE IF NOT EXISTS tag_names (
    tag TEXT PRIMARY KEY
);
-- Revêtement calculé depuis OpenStreetMap ; `geom_key` invalide le calcul si la trace change.
CREATE TABLE IF NOT EXISTS trace_surface (
    trace_id    INTEGER PRIMARY KEY REFERENCES traces(id) ON DELETE CASCADE,
    geom_key    TEXT NOT NULL,
    runs_json   TEXT NOT NULL,
    computed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS not_duplicates (
    a INTEGER NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    b INTEGER NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    PRIMARY KEY (a, b)
);
"#;

/// Une trace avec ce qu'il faut pour calculer son chemin de rangement.
#[derive(Debug, Clone)]
pub struct OrganizeRow {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub sport: String,
    /// Date du parcours, ou à défaut du fichier (secondes Unix).
    pub date: i64,
    pub source: String,
    /// Première collection (ordre alphabétique), s'il y en a une.
    pub collection: Option<String>,
}

/// Erreur SQLite de contrainte d'unicité → message lisible.
fn unique_err(e: rusqlite::Error, message: &str) -> Error {
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            Error::Invalid(message.into())
        }
        _ => Error::Db(e),
    }
}

/// État d'un fichier déjà indexé, pour savoir s'il faut le relire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileState {
    pub id: i64,
    pub hash: String,
    pub size: i64,
    pub mtime: i64,
}

pub struct Index {
    conn: Connection,
}

impl Index {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|source| Error::Io { path: dir.to_owned(), source })?;
        }
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        // Tri « naturel » des noms : np#2 avant np#10, sans tenir compte de la casse.
        conn.create_collation("NATUREL", natural_cmp)?;
        conn.execute_batch(SCHEMA)?;
        let index = Self { conn };
        index.migrate()?;
        Ok(index)
    }

    /// Colonnes ajoutées après la v0.1 : une base existante est complétée sans perte.
    fn migrate(&self) -> Result<()> {
        for (table, column, decl) in [
            ("libraries", "write_gpx", "INTEGER NOT NULL DEFAULT 0"),
            ("traces", "sport", "TEXT NOT NULL DEFAULT 'Vélo'"),
            ("traces", "sport_user", "TEXT"),
            ("traces", "name_user", "TEXT"),
            ("traces", "gpx_date", "INTEGER"),
            ("traces", "tag_suggestions", "TEXT NOT NULL DEFAULT '[]'"),
            ("traces", "tags_ignored", "TEXT NOT NULL DEFAULT '[]'"),
            ("traces", "hint_text", "TEXT NOT NULL DEFAULT ''"),
            ("tag_names", "auto", "INTEGER NOT NULL DEFAULT 0"),
            ("tag_names", "keywords", "TEXT NOT NULL DEFAULT '[]'"),
            ("collections", "is_tour", "INTEGER NOT NULL DEFAULT 0"),
            ("collection_traces", "position", "INTEGER NOT NULL DEFAULT 0"),
        ] {
            let exists: bool = self.conn.query_row(
                &format!("SELECT COUNT(*) > 0 FROM pragma_table_info('{table}') WHERE name = ?1"),
                [column],
                |r| r.get(0),
            )?;
            if !exists {
                self.conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"))?;
            }
        }
        // Règles d’analyse changées (2 : `mtb_easy` de Komoot = Gravel ; 3 : sport lu dans le titre ; 4 : nom nettoyé et date du titre ; 5 : tags proposés ; 6 : texte gardé pour les tags de l’utilisateur) : les fichiers
        // seront relus à la prochaine relecture des dossiers (tags, notes et collections gardés).
        // Tags déjà en détection auto avant que leur nom soit mis dans les mots-clés : on l’y ajoute, une fois.
        if self.setting("tag_name_in_keywords")?.is_none() {
            for tag in self.auto_tags()? {
                self.add_name_to_keywords(&tag)?;
            }
            self.set_setting("tag_name_in_keywords", "1")?;
        }
        if self.setting("analysis_version")?.as_deref() != Some(ANALYSIS_VERSION) {
            // Empreinte factice et unique : relecture complète sans créer de faux doublons.
            self.conn.execute("UPDATE traces SET file_mtime = 0, file_hash = 'relire-' || id", [])?;
            self.set_setting("analysis_version", ANALYSIS_VERSION)?;
        }
        Ok(())
    }

    // ---- Bibliothèques -------------------------------------------------

    pub fn add_library(&self, name: &str, path: &str, mode: &str, pattern: &str, write_gpx: bool) -> Result<Library> {
        self.conn.execute(
            "INSERT INTO libraries(name, path, mode, pattern, write_gpx) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET name = excluded.name, mode = excluded.mode, pattern = excluded.pattern,
             write_gpx = excluded.write_gpx",
            params![name, path, mode, pattern, write_gpx],
        )?;
        let id: i64 = self.conn.query_row("SELECT id FROM libraries WHERE path = ?1", [path], |r| r.get(0))?;
        self.library(id)
    }

    pub fn libraries(&self) -> Result<Vec<Library>> {
        let mut st = self.conn.prepare("SELECT id, name, path, mode, pattern, write_gpx FROM libraries ORDER BY id")?;
        let rows = st.query_map([], row_to_library)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn library(&self, id: i64) -> Result<Library> {
        self.conn
            .query_row("SELECT id, name, path, mode, pattern, write_gpx FROM libraries WHERE id = ?1", [id], row_to_library)
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("bibliothèque {id}")))
    }

    /// Modèle de rangement d’une bibliothèque (déjà vérifié par `organize::validate_pattern`).
    pub fn set_library_pattern(&self, id: i64, pattern: &str) -> Result<()> {
        self.conn.execute("UPDATE libraries SET pattern = ?2 WHERE id = ?1", params![id, pattern])?;
        Ok(())
    }

    pub fn set_library_write_gpx(&self, id: i64, write_gpx: bool) -> Result<()> {
        self.conn.execute("UPDATE libraries SET write_gpx = ?2 WHERE id = ?1", params![id, write_gpx])?;
        Ok(())
    }

    /// Bibliothèque, chemin, tags et notes d'une trace (pour écrire dans son GPX).
    pub fn trace_file(&self, id: i64) -> Result<(Library, String, Vec<String>, String)> {
        let (library_id, path, notes): (i64, String, String) = self
            .conn
            .query_row("SELECT library_id, path, notes FROM traces WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("trace {id}")))?;
        let mut st = self.conn.prepare("SELECT tag FROM tags WHERE trace_id = ?1 ORDER BY tag COLLATE NOCASE")?;
        let tags = st.query_map([id], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        Ok((self.library(library_id)?, path, tags, notes))
    }

    /// Met à jour l'état connu du fichier (après écriture ou déplacement par l'appli),
    /// pour que la prochaine relecture ne le réanalyse pas inutilement.
    pub fn set_file_state(&self, id: i64, path: &str, hash: &str, size: i64, mtime: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE traces SET path = ?2, file_hash = ?3, file_size = ?4, file_mtime = ?5 WHERE id = ?1",
            params![id, path, hash, size, mtime],
        )?;
        Ok(())
    }

    pub fn set_path(&self, id: i64, path: &str) -> Result<()> {
        self.conn.execute("UPDATE traces SET path = ?2 WHERE id = ?1", params![id, path])?;
        Ok(())
    }

    /// Traces d'une bibliothèque avec ce qu'il faut pour les ranger.
    pub fn organize_rows(&self, library_id: i64) -> Result<Vec<OrganizeRow>> {
        let mut st = self.conn.prepare(
            "SELECT t.id, t.path, t.name, COALESCE(t.sport_user, t.sport), COALESCE(t.gpx_date, t.file_mtime), t.source,
                    (SELECT c.name FROM collections c JOIN collection_traces ct ON ct.collection_id = c.id
                     WHERE ct.trace_id = t.id ORDER BY c.name COLLATE NOCASE LIMIT 1)
             FROM traces t WHERE t.library_id = ?1 ORDER BY t.path",
        )?;
        let rows = st.query_map([library_id], |r| {
            Ok(OrganizeRow {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                sport: r.get(3)?,
                date: r.get(4)?,
                source: r.get(5)?,
                collection: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    // ---- Collections ---------------------------------------------------

    pub fn collections(&self) -> Result<Vec<Collection>> {
        let mut st = self.conn.prepare(
            "SELECT c.id, c.name, (SELECT COUNT(*) FROM collection_traces ct WHERE ct.collection_id = c.id), c.is_tour
             FROM collections c ORDER BY c.name COLLATE NOCASE",
        )?;
        let rows = st.query_map([], |r| {
            Ok(Collection { id: r.get(0)?, name: r.get(1)?, count: r.get(2)?, is_tour: r.get(3)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn create_collection(&self, name: &str, now: i64) -> Result<Collection> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("le nom de la collection est vide".into()));
        }
        self.conn
            .execute("INSERT INTO collections(name, created_at) VALUES (?1, ?2)", params![name, now])
            .map_err(|e| unique_err(e, "une collection porte déjà ce nom"))?;
        Ok(Collection { id: self.conn.last_insert_rowid(), name: name.into(), count: 0, is_tour: false })
    }

    pub fn rename_collection(&self, id: i64, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("le nom de la collection est vide".into()));
        }
        self.conn
            .execute("UPDATE collections SET name = ?2 WHERE id = ?1", params![id, name])
            .map_err(|e| unique_err(e, "une collection porte déjà ce nom"))?;
        Ok(())
    }

    /// Supprime la collection (les traces restent dans la bibliothèque).
    pub fn delete_collection(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn set_trace_collections(&mut self, trace_id: i64, ids: &[i64]) -> Result<()> {
        let tx = self.conn.transaction()?;
        // On ne retire que les collections quittées : l'ordre des étapes d'un tour est gardé.
        // (Liste en JSON : vide, elle retire bien tout ; « NOT IN (NULL) » ne retirerait rien.)
        tx.execute(
            "DELETE FROM collection_traces WHERE trace_id = ?1
               AND collection_id NOT IN (SELECT value FROM json_each(?2))",
            params![trace_id, serde_json::to_string(ids)?],
        )?;
        for c in ids {
            // Nouvelle étape : à la fin du tour.
            tx.execute(
                "INSERT OR IGNORE INTO collection_traces(collection_id, trace_id, position)
                 VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM collection_traces WHERE collection_id = ?1))",
                params![c, trace_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ---- Tags ----------------------------------------------------------

    pub fn tag_counts(&self) -> Result<Vec<TagCount>> {
        // Tags posés sur des traces, plus ceux créés à l’avance (0 trace).
        let mut st = self.conn.prepare(
            "SELECT tag, SUM(n), MAX(auto) FROM (SELECT tag, COUNT(*) AS n, 0 AS auto FROM tags GROUP BY tag
                                      UNION ALL SELECT tag, 0, auto FROM tag_names)
             GROUP BY tag ORDER BY tag COLLATE NOCASE",
        )?;
        let rows = st.query_map([], |r| Ok(TagCount { tag: r.get(0)?, count: r.get(1)?, auto: r.get(2)?, keywords: vec![] }))?;
        let mut counts: Vec<TagCount> = rows.collect::<std::result::Result<_, _>>()?;
        let rules: std::collections::HashMap<String, Vec<String>> = self.auto_tag_rules_all()?.into_iter().collect();
        for c in &mut counts {
            if let Some(k) = rules.get(&c.tag) {
                c.keywords = k.clone();
            }
        }
        Ok(counts)
    }

    /// Renomme un tag partout ; vers un tag existant, les deux fusionnent.
    /// Renvoie les traces concernées (pour réécrire leur GPX).
    pub fn rename_tag(&mut self, old: &str, new: &str) -> Result<Vec<i64>> {
        let new = new.trim();
        if new.is_empty() {
            return Err(Error::Invalid("le nouveau nom du tag est vide".into()));
        }
        let ids = self.trace_ids_with_tag(old)?;
        let tx = self.conn.transaction()?;
        tx.execute("INSERT OR IGNORE INTO tags(trace_id, tag) SELECT trace_id, ?2 FROM tags WHERE tag = ?1", params![old, new])?;
        if old != new {
            tx.execute("DELETE FROM tags WHERE tag = ?1", [old])?;
            // Le tag garde son option de détection sous son nouveau nom.
            let auto: Option<bool> =
                tx.query_row("SELECT auto FROM tag_names WHERE tag = ?1", [old], |r| r.get(0)).optional()?;
            let keywords: String = tx
                .query_row("SELECT keywords FROM tag_names WHERE tag = ?1", [old], |r| r.get(0))
                .optional()?
                .unwrap_or_else(|| "[]".into());
            if let Some(auto) = auto {
                tx.execute("DELETE FROM tag_names WHERE tag = ?1", [old])?;
                tx.execute(
                    "INSERT INTO tag_names(tag, auto, keywords) VALUES (?1, ?2, ?3)
                     ON CONFLICT(tag) DO UPDATE SET auto = MAX(auto, excluded.auto), keywords = excluded.keywords",
                    params![new, auto, keywords],
                )?;
            }
        }
        tx.commit()?;
        Ok(ids)
    }

    /// Retire un tag de toutes les traces. Renvoie les traces concernées.
    pub fn delete_tag(&self, tag: &str) -> Result<Vec<i64>> {
        let ids = self.trace_ids_with_tag(tag)?;
        self.conn.execute("DELETE FROM tags WHERE tag = ?1", [tag])?;
        self.conn.execute("DELETE FROM tag_names WHERE tag = ?1", [tag])?;
        Ok(ids)
    }

    fn trace_ids_with_tag(&self, tag: &str) -> Result<Vec<i64>> {
        let mut st = self.conn.prepare("SELECT trace_id FROM tags WHERE tag = ?1")?;
        let rows = st.query_map([tag], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    // ---- Doublons ------------------------------------------------------

    /// Fichiers identiques, puis doublons probables : même distance (±1 %),
    /// même D+ (±5 % ou 30 m), départs et arrivées à moins de 300 m. Les
    /// paires déclarées « pas des doublons » sont ignorées.
    pub fn duplicate_sets(&self) -> Result<Vec<DuplicateSet>> {
        let all = self.list(&TraceFilter { sort: SortKey::Date, ascending: true, ..Default::default() })?;
        let mut hash_of = std::collections::HashMap::new();
        {
            let mut st = self.conn.prepare("SELECT id, file_hash FROM traces")?;
            for row in st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
                let (id, h) = row?;
                hash_of.insert(id, h);
            }
        }
        let mut excluded = std::collections::HashSet::new();
        {
            let mut st = self.conn.prepare("SELECT a, b FROM not_duplicates")?;
            for row in st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
                excluded.insert(row?);
            }
        }
        let n = all.len();
        let mut parent: Vec<usize> = (0..n).collect();
        fn find(p: &mut [usize], i: usize) -> usize {
            let mut r = i;
            while p[r] != r {
                r = p[r];
            }
            let mut i = i;
            while p[i] != r {
                let next = p[i];
                p[i] = r;
                i = next;
            }
            r
        }
        for i in 0..n {
            for j in (i + 1)..n {
                let (a, b) = (&all[i], &all[j]);
                let pair = (a.id.min(b.id), a.id.max(b.id));
                if excluded.contains(&pair) {
                    continue;
                }
                let same_file = hash_of.get(&a.id) == hash_of.get(&b.id);
                let same_route = similar_routes(&RouteKey::of(a), &RouteKey::of(b));
                if same_file || same_route {
                    let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
                    parent[ri] = rj;
                }
            }
        }
        let mut groups: std::collections::BTreeMap<usize, Vec<usize>> = Default::default();
        for i in 0..n {
            let r = find(&mut parent, i);
            groups.entry(r).or_default().push(i);
        }
        let mut sets: Vec<DuplicateSet> = groups
            .into_values()
            .filter(|g| g.len() > 1)
            .map(|g| {
                let first_hash = hash_of.get(&all[g[0]].id);
                let all_same = g.iter().all(|&i| hash_of.get(&all[i].id) == first_hash);
                DuplicateSet {
                    kind: if all_same { "identical" } else { "probable" }.into(),
                    traces: g.iter().map(|&i| all[i].clone()).collect(),
                }
            })
            .collect();
        sets.sort_by_key(|s| (s.kind != "identical", s.traces[0].added_at));
        Ok(sets)
    }

    /// Déclare que ces traces ne sont pas des doublons entre elles.
    pub fn mark_not_duplicates(&self, ids: &[i64]) -> Result<()> {
        for (k, a) in ids.iter().enumerate() {
            for b in &ids[k + 1..] {
                self.conn.execute(
                    "INSERT OR IGNORE INTO not_duplicates(a, b) VALUES (?1, ?2)",
                    params![a.min(b), a.max(b)],
                )?;
            }
        }
        Ok(())
    }

    // ---- Réglages ------------------------------------------------------

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn remove_trace(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM traces WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Nom choisi par l'utilisateur : il reste en place aux relectures du GPX
    /// (`None` : retour au nom lu dans le fichier, `file_name`).
    pub fn set_name(&self, id: i64, name: Option<&str>, file_name: &str) -> Result<()> {
        match name.map(str::trim).filter(|n| !n.is_empty()) {
            Some(n) => self.conn.execute("UPDATE traces SET name_user = ?2, name = ?2 WHERE id = ?1", params![id, n])?,
            None => self.conn.execute("UPDATE traces SET name_user = NULL, name = ?2 WHERE id = ?1", params![id, file_name])?,
        };
        Ok(())
    }

    /// La trace a-t-elle un nom choisi par l'utilisateur ?
    pub fn has_user_name(&self, id: i64) -> Result<bool> {
        Ok(self.conn.query_row("SELECT name_user IS NOT NULL FROM traces WHERE id = ?1", [id], |r| r.get(0))?)
    }

    pub fn set_sport(&self, id: i64, sport: Option<&str>) -> Result<()> {
        self.conn.execute("UPDATE traces SET sport_user = ?2 WHERE id = ?1", params![id, sport])?;
        Ok(())
    }

    /// Id d'une trace d'après son chemin.
    pub fn trace_id_by_path(&self, path: &str) -> Result<Option<i64>> {
        Ok(self.conn.query_row("SELECT id FROM traces WHERE path = ?1", [path], |r| r.get(0)).optional()?)
    }

    pub fn remove_library(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM libraries WHERE id = ?1", [id])?;
        Ok(())
    }

    // ---- Traces --------------------------------------------------------

    pub fn file_state(&self, path: &str) -> Result<Option<FileState>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, file_hash, file_size, file_mtime FROM traces WHERE path = ?1",
                [path],
                |r| Ok(FileState { id: r.get(0)?, hash: r.get(1)?, size: r.get(2)?, mtime: r.get(3)? }),
            )
            .optional()?)
    }

    /// Ajoute ou met à jour une trace. Renvoie (id, true si ajoutée).
    #[allow(clippy::too_many_arguments)]
    pub fn upsert_trace(
        &mut self,
        library_id: i64,
        path: &str,
        hash: &str,
        size: i64,
        mtime: i64,
        source: &str,
        added_at: i64,
        a: &TraceAnalysis,
    ) -> Result<(i64, bool)> {
        let preview = preview(&a.profile, 60);
        let tx = self.conn.transaction()?;
        let existing: Option<i64> =
            tx.query_row("SELECT id FROM traces WHERE path = ?1", [path], |r| r.get(0)).optional()?;
        let values = params![
            library_id,
            path,
            hash,
            size,
            mtime,
            a.name,
            a.distance_km,
            a.elevation_gain,
            a.elevation_loss,
            a.ele_min,
            a.ele_max,
            a.hilliness.as_str(),
            a.wind.as_str(),
            source,
            a.start_lat,
            a.start_lon,
            serde_json::to_string(&a.bbox)?,
            a.point_count as i64,
            a.has_time,
            a.creator,
            serde_json::to_string(&preview)?,
            serde_json::to_string(&a.profile)?,
            crate::sport::sport_for(a.sport_type.as_deref(), &a.name),
            a.date,
        ];
        let id = if let Some(id) = existing {
            tx.execute(
                "UPDATE traces SET library_id=?1, path=?2, file_hash=?3, file_size=?4, file_mtime=?5, name=COALESCE(name_user, ?6),
                 distance_km=?7, elevation_gain=?8, elevation_loss=?9, ele_min=?10, ele_max=?11, hilliness=?12,
                 wind=?13, source=?14, start_lat=?15, start_lon=?16, bbox_json=?17, point_count=?18, has_time=?19,
                 creator=?20, preview_json=?21, profile_json=?22, sport=?23, gpx_date=?24 WHERE id = ?25",
                rusqlite::params_from_iter(values.iter().copied().chain(std::iter::once(&id as &dyn rusqlite::ToSql))),
            )?;
            tx.execute("DELETE FROM pois WHERE trace_id = ?1", [id])?;
            id
        } else {
            tx.execute(
                "INSERT INTO traces(library_id, path, file_hash, file_size, file_mtime, name, distance_km,
                 elevation_gain, elevation_loss, ele_min, ele_max, hilliness, wind, source, start_lat, start_lon,
                 bbox_json, point_count, has_time, creator, preview_json, profile_json, sport, gpx_date, added_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)",
                rusqlite::params_from_iter(values.iter().copied().chain(std::iter::once(&added_at as &dyn rusqlite::ToSql))),
            )?;
            tx.last_insert_rowid()
        };
        tx.execute(
            "UPDATE traces SET tag_suggestions = ?2, hint_text = ?3 WHERE id = ?1",
            params![id, serde_json::to_string(&a.tag_hints)?, a.hint_text],
        )?;
        {
            let mut st = tx.prepare(
                "INSERT INTO pois(trace_id, idx, name, kind, km, lat, lon, symbol) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            )?;
            for (i, p) in a.pois.iter().enumerate() {
                st.execute(params![id, i as i64, p.name, p.kind.as_str(), p.km, p.lat, p.lon, p.symbol])?;
            }
        }
        tx.commit()?;
        Ok((id, existing.is_none()))
    }

    /// Retire de la bibliothèque les fichiers qui n'existent plus.
    pub fn remove_missing(&self, library_id: i64, seen: &std::collections::HashSet<String>) -> Result<usize> {
        let mut st = self.conn.prepare("SELECT id, path FROM traces WHERE library_id = ?1")?;
        let gone: Vec<i64> = st
            .query_map([library_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .filter_map(|r| r.ok())
            .filter(|(_, p)| !seen.contains(p))
            .map(|(id, _)| id)
            .collect();
        for id in &gone {
            self.conn.execute("DELETE FROM traces WHERE id = ?1", [id])?;
        }
        Ok(gone.len())
    }

    pub fn set_tags(&mut self, id: i64, tags: &[String]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM tags WHERE trace_id = ?1", [id])?;
        for t in tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
            tx.execute("INSERT OR IGNORE INTO tags(trace_id, tag) VALUES (?1, ?2)", params![id, t])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn set_notes(&self, id: i64, notes: &str) -> Result<()> {
        self.conn.execute("UPDATE traces SET notes = ?2 WHERE id = ?1", params![id, notes])?;
        Ok(())
    }

    pub fn set_surface_type(&self, id: i64, surface: Option<&str>) -> Result<()> {
        self.conn.execute("UPDATE traces SET surface_type = ?2 WHERE id = ?1", params![id, surface])?;
        Ok(())
    }

    pub fn all_tags(&self) -> Result<Vec<String>> {
        let mut st = self.conn.prepare("SELECT tag FROM tags UNION SELECT tag FROM tag_names ORDER BY tag COLLATE NOCASE")?;
        let rows = st.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Liste filtrée et triée (filtres de la bibliothèque v0.1).
    pub fn list(&self, f: &TraceFilter) -> Result<Vec<TraceSummary>> {
        let mut sql = String::from(
            "SELECT t.id, t.library_id, t.path, t.name, t.distance_km, t.elevation_gain, t.hilliness, t.wind,
                    t.surface_type, t.source, t.added_at, t.preview_json,
                    (SELECT COUNT(*) FROM pois p WHERE p.trace_id = t.id),
                    (SELECT group_concat(tag, char(31)) FROM tags g WHERE g.trace_id = t.id),
                    COALESCE(t.sport_user, t.sport)
             FROM traces t WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        fn arg(sql: &mut String, args: &mut Vec<Box<dyn rusqlite::ToSql>>, clause: &str, v: Box<dyn rusqlite::ToSql>) {
            args.push(v);
            sql.push_str(&clause.replace('?', &format!("?{}", args.len())));
        }
        if let Some(q) = f.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
            let like = format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
            args.push(Box::new(like));
            let n = args.len();
            sql.push_str(&format!(
                " AND (t.name LIKE ?{n} ESCAPE '\\' OR t.notes LIKE ?{n} ESCAPE '\\' \
                 OR EXISTS (SELECT 1 FROM tags g WHERE g.trace_id = t.id AND g.tag LIKE ?{n} ESCAPE '\\'))"
            ));
        }
        if let Some(v) = f.distance_min {
            arg(&mut sql, &mut args, " AND t.distance_km >= ?", Box::new(v));
        }
        if let Some(v) = f.distance_max {
            arg(&mut sql, &mut args, " AND t.distance_km <= ?", Box::new(v));
        }
        if let Some(v) = f.elevation_min {
            arg(&mut sql, &mut args, " AND t.elevation_gain >= ?", Box::new(v));
        }
        if let Some(v) = f.elevation_max {
            arg(&mut sql, &mut args, " AND t.elevation_gain <= ?", Box::new(v));
        }
        if let Some(h) = f.hilliness {
            arg(&mut sql, &mut args, " AND t.hilliness = ?", Box::new(h.as_str()));
        }
        if let Some(s) = f.sport.as_deref().filter(|s| !s.is_empty()) {
            arg(&mut sql, &mut args, " AND COALESCE(t.sport_user, t.sport) = ?", Box::new(s.to_string()));
        }
        if let Some(s) = f.surface_type.as_deref().filter(|s| !s.is_empty()) {
            arg(&mut sql, &mut args, " AND t.surface_type = ?", Box::new(s.to_string()));
        }
        if let Some(s) = f.source.as_deref().filter(|s| !s.is_empty()) {
            arg(&mut sql, &mut args, " AND t.source = ?", Box::new(s.to_string()));
        }
        if let Some(tag) = f.tag.as_deref().filter(|s| !s.is_empty()) {
            arg(&mut sql, &mut args, " AND EXISTS (SELECT 1 FROM tags g WHERE g.trace_id = t.id AND g.tag = ?)", Box::new(tag.to_string()));
        }
        if let Some(c) = f.collection {
            arg(
                &mut sql,
                &mut args,
                " AND EXISTS (SELECT 1 FROM collection_traces c WHERE c.trace_id = t.id AND c.collection_id = ?)",
                Box::new(c),
            );
        }
        let dir = if f.ascending { "ASC" } else { "DESC" };
        sql.push_str(&match f.sort {
            SortKey::Date => format!(" ORDER BY t.added_at {dir}, t.id {dir}"),
            SortKey::Distance => format!(" ORDER BY t.distance_km {dir}"),
            SortKey::Elevation => format!(" ORDER BY t.elevation_gain {dir}"),
            SortKey::Hilliness => format!(" ORDER BY t.elevation_gain / MAX(t.distance_km, 0.001) {dir}"),
            SortKey::Name => format!(" ORDER BY t.name COLLATE NATUREL {dir}"),
            SortKey::Sport => format!(" ORDER BY COALESCE(t.sport_user, t.sport) COLLATE NOCASE {dir}, t.name COLLATE NATUREL"),
        });

        let mut st = self.conn.prepare(&sql)?;
        let rows = st.query_map(rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())), row_to_summary)?;
        let mut out: Vec<TraceSummary> = rows.collect::<std::result::Result<_, _>>()?;
        if let Some(w) = f.wind {
            let tol = if f.wind_near { 45.0 } else { 0.0 };
            out.retain(|t| t.wind.diff(w) <= tol);
        }
        Ok(out)
    }

    pub fn get(&self, id: i64) -> Result<TraceDetail> {
        let row = self
            .conn
            .query_row(
                "SELECT t.id, t.library_id, t.path, t.name, t.distance_km, t.elevation_gain, t.hilliness, t.wind,
                        t.surface_type, t.source, t.added_at, t.preview_json,
                        (SELECT COUNT(*) FROM pois p WHERE p.trace_id = t.id),
                        (SELECT group_concat(tag, char(31)) FROM tags g WHERE g.trace_id = t.id),
                        COALESCE(t.sport_user, t.sport),
                        t.elevation_loss, t.ele_min, t.ele_max, t.notes, t.has_time, t.creator, t.profile_json
                 FROM traces t WHERE t.id = ?1",
                [id],
                |r| {
                    Ok((
                        row_to_summary(r)?,
                        r.get::<_, f64>(15)?,
                        r.get::<_, f64>(16)?,
                        r.get::<_, f64>(17)?,
                        r.get::<_, String>(18)?,
                        r.get::<_, bool>(19)?,
                        r.get::<_, Option<String>>(20)?,
                        r.get::<_, String>(21)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("trace {id}")))?;
        let (summary, loss, ele_min, ele_max, notes, has_time, creator, profile_json) = row;
        let mut st =
            self.conn.prepare("SELECT name, kind, km, lat, lon, symbol FROM pois WHERE trace_id = ?1 ORDER BY idx")?;
        let pois = st
            .query_map([id], |r| {
                Ok(Poi {
                    name: r.get(0)?,
                    kind: PoiKind::parse(&r.get::<_, String>(1)?),
                    km: r.get(2)?,
                    lat: r.get(3)?,
                    lon: r.get(4)?,
                    symbol: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut st = self.conn.prepare("SELECT collection_id FROM collection_traces WHERE trace_id = ?1")?;
        let collection_ids = st.query_map([id], |r| r.get(0))?.collect::<std::result::Result<Vec<i64>, _>>()?;
        let profile: Vec<ProfilePoint> = serde_json::from_str(&profile_json)?;
        let surface = self
            .conn
            .query_row("SELECT geom_key, runs_json FROM trace_surface WHERE trace_id = ?1", [id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .optional()?
            .filter(|(key, _)| *key == geom_key(&profile))
            .map(|(_, json)| serde_json::from_str(&json))
            .transpose()?;
        // Tags proposés : ni déjà posés, ni écartés par l’utilisateur.
        let (hints, ignored, text): (String, String, String) = self.conn.query_row(
            "SELECT tag_suggestions, tags_ignored, hint_text FROM traces WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let ignored: Vec<String> = serde_json::from_str(&ignored).unwrap_or_default();
        let mut proposed: Vec<String> = serde_json::from_str(&hints).unwrap_or_default();
        // Tags de l’utilisateur à détecter (ex. « NP# »), cherchés dans le titre brut et les
        // métadonnées ; à défaut (trace pas encore relue), dans le nom affiché.
        let text = if text.is_empty() { summary.name.clone() } else { text };
        for (tag, words) in self.auto_tag_rules()? {
            let found = words.iter().any(|w| crate::autotags::text_has_tag(&text, w));
            if found && !proposed.iter().any(|p| p.to_lowercase() == tag.to_lowercase()) {
                proposed.push(tag);
            }
        }
        let same = |a: &str, b: &str| a.to_lowercase() == b.to_lowercase();
        let tag_suggestions = proposed
            .into_iter()
            .filter(|h| !summary.tags.iter().chain(&ignored).any(|t| same(t, h)))
            .collect();
        Ok(TraceDetail {
            collection_ids,
            summary,
            elevation_loss: loss,
            ele_min,
            ele_max,
            notes,
            has_time,
            creator,
            profile,
            surface,
            tag_suggestions,
            pois,
        })
    }

    /// Fichiers identiques (même empreinte SHA-256).
    pub fn duplicates(&self) -> Result<Vec<DuplicateGroup>> {
        let mut st = self.conn.prepare(
            "SELECT file_hash, group_concat(path, char(31)) FROM traces
             GROUP BY file_hash HAVING COUNT(*) > 1 ORDER BY MIN(added_at)",
        )?;
        let rows = st.query_map([], |r| {
            Ok(DuplicateGroup {
                hash: r.get(0)?,
                paths: r.get::<_, String>(1)?.split('\u{1f}').map(String::from).collect(),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn count(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM traces", [], |r| r.get(0))?)
    }
}

fn row_to_library(r: &rusqlite::Row) -> rusqlite::Result<Library> {
    Ok(Library {
        id: r.get(0)?,
        name: r.get(1)?,
        path: r.get(2)?,
        mode: r.get(3)?,
        pattern: r.get(4)?,
        write_gpx: r.get(5)?,
    })
}

fn row_to_summary(r: &rusqlite::Row) -> rusqlite::Result<TraceSummary> {
    let hill: String = r.get(6)?;
    let wind: String = r.get(7)?;
    let preview: String = r.get(11)?;
    let tags: Option<String> = r.get(13)?;
    Ok(TraceSummary {
        id: r.get(0)?,
        library_id: r.get(1)?,
        path: r.get(2)?,
        name: r.get(3)?,
        distance_km: r.get(4)?,
        elevation_gain: r.get(5)?,
        hilliness: Hilliness::parse(&hill).unwrap_or(Hilliness::Flat),
        wind: WindDirection::parse(&wind).unwrap_or(WindDirection::N),
        surface_type: r.get(8)?,
        source: r.get(9)?,
        sport: r.get(14)?,
        added_at: r.get(10)?,
        preview: serde_json::from_str(&preview).unwrap_or_default(),
        poi_count: r.get(12)?,
        tags: tags.map(|t| t.split('\u{1f}').map(String::from).collect()).unwrap_or_default(),
    })
}

/// Empreinte de la géométrie : le revêtement est à recalculer si la trace change
/// (mais pas si seuls les tags ou les notes du GPX changent).
fn geom_key(profile: &[ProfilePoint]) -> String {
    match (profile.first(), profile.last()) {
        (Some(a), Some(b)) => format!("{}:{:.3}:{:.5},{:.5}:{:.5},{:.5}", profile.len(), b.km, a.lat, a.lon, b.lat, b.lon),
        _ => String::new(),
    }
}

impl Index {
    /// Géométrie de la trace (profil) pour le calcul du revêtement.
    pub fn profile(&self, id: i64) -> Result<Vec<ProfilePoint>> {
        let json: String = self
            .conn
            .query_row("SELECT profile_json FROM traces WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("trace {id}")))?;
        Ok(serde_json::from_str(&json)?)
    }

    /// Enregistre le revêtement calculé depuis OpenStreetMap.
    pub fn set_surface(&self, id: i64, runs: &[crate::surface::SurfaceRun], now: i64) -> Result<()> {
        let key = geom_key(&self.profile(id)?);
        self.conn.execute(
            "INSERT INTO trace_surface(trace_id, geom_key, runs_json, computed_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(trace_id) DO UPDATE SET geom_key = excluded.geom_key, runs_json = excluded.runs_json,
             computed_at = excluded.computed_at",
            params![id, key, serde_json::to_string(runs)?, now],
        )?;
        Ok(())
    }
}

/// Sous-échantillonnage régulier du profil pour les vignettes.
fn preview(profile: &[ProfilePoint], n: usize) -> Vec<[f64; 2]> {
    if profile.is_empty() {
        return vec![];
    }
    let n = n.min(profile.len());
    (0..n)
        .map(|i| {
            let p = &profile[i * (profile.len() - 1) / (n - 1).max(1)];
            [p.lat, p.lon]
        })
        .collect()
}

impl Index {
    /// Écarte des tags proposés : ils ne seront plus suggérés pour cette trace.
    pub fn ignore_tag_suggestions(&self, id: i64, tags: &[String]) -> Result<()> {
        let json: String = self.conn.query_row("SELECT tags_ignored FROM traces WHERE id = ?1", [id], |r| r.get(0))?;
        let mut ignored: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
        for t in tags {
            if !ignored.iter().any(|i| i.eq_ignore_ascii_case(t)) {
                ignored.push(t.clone());
            }
        }
        self.conn.execute(
            "UPDATE traces SET tags_ignored = ?2 WHERE id = ?1",
            params![id, serde_json::to_string(&ignored)?],
        )?;
        Ok(())
    }
}

/// Ce qui sert à reconnaître un même parcours (doublon probable).
pub(crate) struct RouteKey {
    pub distance_km: f64,
    pub elevation_gain: f64,
    pub start: Option<[f64; 2]>,
    pub end: Option<[f64; 2]>,
}

impl RouteKey {
    pub(crate) fn of(t: &TraceSummary) -> Self {
        Self {
            distance_km: t.distance_km,
            elevation_gain: t.elevation_gain,
            start: t.preview.first().copied(),
            end: t.preview.last().copied(),
        }
    }
}

/// Même parcours probable : distance ±1 %, D+ ±5 % (ou 30 m), départ et arrivée à moins de 300 m.
pub(crate) fn similar_routes(a: &RouteKey, b: &RouteKey) -> bool {
    let near = |x: Option<[f64; 2]>, y: Option<[f64; 2]>| match (x, y) {
        (Some(x), Some(y)) => crate::geo::haversine_km(x[0], x[1], y[0], y[1]) < 0.3,
        _ => false,
    };
    (a.distance_km - b.distance_km).abs() <= 0.01 * a.distance_km.max(b.distance_km).max(1.0)
        && (a.elevation_gain - b.elevation_gain).abs() <= (0.05 * a.elevation_gain.max(b.elevation_gain)).max(30.0)
        && near(a.start, b.start)
        && near(a.end, b.end)
}

impl Index {
    /// Noms des traces dont le fichier a cette empreinte.
    /// Noms des traces par empreinte de fichier, pour toutes les traces.
    pub fn names_by_hash_all(&self) -> Result<std::collections::HashMap<String, Vec<String>>> {
        let mut st = self.conn.prepare("SELECT file_hash, name FROM traces ORDER BY name")?;
        let mut out: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (h, n) = row?;
            out.entry(h).or_default().push(n);
        }
        Ok(out)
    }

    pub fn names_by_hash(&self, hash: &str) -> Result<Vec<String>> {
        let mut st = self.conn.prepare("SELECT name FROM traces WHERE file_hash = ?1 ORDER BY name")?;
        let names = st.query_map([hash], |r| r.get(0))?.collect::<std::result::Result<Vec<String>, _>>()?;
        Ok(names)
    }
}

impl Index {
    /// Crée un tag sans l'attacher à une trace (onglet Tags) : il est ensuite
    /// proposé dans les listes de tags.
    pub fn create_tag(&self, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("Le nom du tag est vide.".into()));
        }
        // Comparaison en Rust : NOCASE de SQLite ne connaît que l’ASCII (« Été » ≠ « été »).
        let lower = name.to_lowercase();
        let exists = self.all_tags()?.iter().any(|t| t.to_lowercase() == lower);
        if exists {
            return Err(Error::Invalid(format!("Le tag « {name} » existe déjà.")));
        }
        self.conn.execute("INSERT INTO tag_names(tag) VALUES (?1)", [name])?;
        Ok(())
    }
}

impl Index {
    /// Active ou non la détection automatique d'un tag dans les titres et métadonnées.
    pub fn set_tag_auto(&self, tag: &str, auto: bool) -> Result<()> {
        self.conn.execute(
            "INSERT INTO tag_names(tag, auto) VALUES (?1, ?2) ON CONFLICT(tag) DO UPDATE SET auto = excluded.auto",
            params![tag, auto],
        )?;
        // À l’activation, le nom du tag rejoint ses mots-clés (visible et modifiable).
        if auto {
            self.add_name_to_keywords(tag)?;
        }
        Ok(())
    }

    fn add_name_to_keywords(&self, tag: &str) -> Result<()> {
        let json: String = self.conn.query_row("SELECT keywords FROM tag_names WHERE tag = ?1", [tag], |r| r.get(0))?;
        let mut k: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
        if !k.iter().any(|w| w.to_lowercase() == tag.to_lowercase()) {
            k.insert(0, tag.to_string());
            self.conn.execute(
                "UPDATE tag_names SET keywords = ?2 WHERE tag = ?1",
                params![tag, serde_json::to_string(&k)?],
            )?;
        }
        Ok(())
    }

    /// Tags que l'utilisateur veut voir détectés automatiquement.
    pub fn auto_tags(&self) -> Result<Vec<String>> {
        let mut st = self.conn.prepare("SELECT tag FROM tag_names WHERE auto = 1 ORDER BY tag")?;
        let tags = st.query_map([], |r| r.get(0))?.collect::<std::result::Result<Vec<String>, _>>()?;
        Ok(tags)
    }
}

impl Index {
    /// Mots-clés de détection d'un tag (en plus de son nom). Ajouter des mots-clés
    /// active la détection du tag.
    pub fn set_tag_keywords(&self, tag: &str, keywords: &[String]) -> Result<()> {
        let mut clean: Vec<String> = Vec::new();
        for k in keywords.iter().map(|k| k.trim()).filter(|k| !k.is_empty()) {
            if !clean.iter().any(|c| c.to_lowercase() == k.to_lowercase()) {
                clean.push(k.to_string());
            }
        }
        let was_auto = self.auto_tags()?.iter().any(|t| t == tag);
        let json = serde_json::to_string(&clean)?;
        self.conn.execute(
            "INSERT INTO tag_names(tag, auto, keywords) VALUES (?1, ?2, ?3)
             ON CONFLICT(tag) DO UPDATE SET keywords = excluded.keywords, auto = MAX(auto, excluded.auto)",
            params![tag, !clean.is_empty(), json],
        )?;
        // Ajouter des mots-clés active la détection : comme avec l’interrupteur, le nom
        // du tag rejoint alors ses mots-clés.
        if !was_auto && !clean.is_empty() {
            self.add_name_to_keywords(tag)?;
        }
        Ok(())
    }

    /// Mots-clés de tous les tags connus de `tag_names` (détection active ou non).
    fn auto_tag_rules_all(&self) -> Result<Vec<(String, Vec<String>)>> {
        let mut st = self.conn.prepare("SELECT tag, keywords FROM tag_names")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (tag, json) = row?;
            out.push((tag, serde_json::from_str(&json).unwrap_or_default()));
        }
        Ok(out)
    }

    /// Tags à détecter avec leurs mots : le nom du tag, puis ses mots-clés.
    pub fn auto_tag_rules(&self) -> Result<Vec<(String, Vec<String>)>> {
        let auto = self.auto_tags()?;
        Ok(self
            .auto_tag_rules_all()?
            .into_iter()
            .filter(|(t, _)| auto.contains(t))
            // Les mots-clés font foi (le nom du tag y est mis à l’activation, et peut en être
            // retiré) ; sans mot-clé, le nom du tag.
            .map(|(t, k)| {
                let words = if k.is_empty() { vec![t.clone()] } else { k };
                (t, words)
            })
            .collect())
    }
}

/// Comparaison « naturelle » : les nombres sont comparés par leur valeur
/// (« np#2 » avant « np#10 », « BRM 300 » avant « BRM 1000 »), le texte sans
/// tenir compte de la casse.
pub(crate) fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    fn chunks(s: &str) -> Vec<(bool, String)> {
        let mut out: Vec<(bool, String)> = Vec::new();
        for c in s.chars() {
            let digit = c.is_ascii_digit();
            match out.last_mut() {
                Some((d, buf)) if *d == digit => buf.push(c),
                _ => out.push((digit, c.to_string())),
            }
        }
        out
    }
    let (ca, cb) = (chunks(a), chunks(b));
    for (x, y) in ca.iter().zip(cb.iter()) {
        let ord = match (x, y) {
            ((true, n1), (true, n2)) => {
                let (t1, t2) = (n1.trim_start_matches('0'), n2.trim_start_matches('0'));
                t1.len().cmp(&t2.len()).then_with(|| t1.cmp(t2)).then_with(|| n1.len().cmp(&n2.len()))
            }
            ((_, s1), (_, s2)) => s1.to_lowercase().cmp(&s2.to_lowercase()),
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    ca.len().cmp(&cb.len()).then_with(|| a.cmp(b))
}

#[cfg(test)]
mod tri_naturel {
    use super::natural_cmp;

    #[test]
    fn nombres_dans_l_ordre() {
        let mut v = vec!["np#10 Gravel", "np#2 Route", "NP#1 boucle", "BRM 1000", "BRM 300", "brm 600", "Sortie"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, vec!["BRM 300", "brm 600", "BRM 1000", "NP#1 boucle", "np#2 Route", "np#10 Gravel", "Sortie"]);
        // Et dans SQLite, via la collation de l’index.
        let idx = super::Index::open_in_memory().unwrap();
        let before: bool = idx.conn.query_row("SELECT 'np#2' < 'np#10' COLLATE NATUREL", [], |r| r.get(0)).unwrap();
        assert!(before);
    }
}

impl Index {
    /// Applique une modification à plusieurs traces. Renvoie celles dont les
    /// tags ont changé (pour réécrire leur GPX si la bibliothèque l'autorise).
    pub fn batch_edit(&mut self, ids: &[i64], edit: &BatchEdit, now: i64) -> Result<Vec<i64>> {
        let same = |a: &str, b: &str| a.to_lowercase() == b.to_lowercase();
        // Collections à ajouter : par nom, créées au besoin.
        let mut add_cols = Vec::new();
        for name in edit.add_collections.iter().map(|n| n.trim()).filter(|n| !n.is_empty()) {
            let existing = self.collections()?.into_iter().find(|c| same(&c.name, name));
            add_cols.push(match existing {
                Some(c) => c.id,
                None => self.create_collection(name, now)?.id,
            });
        }
        let mut tags_changed = Vec::new();
        for &id in ids {
            let t = self.get(id)?;
            if !edit.add_tags.is_empty() || !edit.remove_tags.is_empty() {
                let mut tags: Vec<String> =
                    t.summary.tags.iter().filter(|x| !edit.remove_tags.iter().any(|r| same(r, x))).cloned().collect();
                for a in edit.add_tags.iter().map(|a| a.trim()).filter(|a| !a.is_empty()) {
                    if !tags.iter().any(|x| same(x, a)) {
                        tags.push(a.to_string());
                    }
                }
                if tags != t.summary.tags {
                    self.set_tags(id, &tags)?;
                    tags_changed.push(id);
                }
            }
            if edit.change_sport {
                self.set_sport(id, edit.sport.as_deref().map(str::trim).filter(|s| !s.is_empty()))?;
            }
            if !add_cols.is_empty() || !edit.remove_collections.is_empty() {
                let mut cols: Vec<i64> =
                    t.collection_ids.iter().copied().filter(|c| !edit.remove_collections.contains(c)).collect();
                for c in &add_cols {
                    if !cols.contains(c) {
                        cols.push(*c);
                    }
                }
                self.set_trace_collections(id, &cols)?;
            }
        }
        Ok(tags_changed)
    }
}

impl Index {
    /// Fait d'une collection un tour (ou l'inverse). En devenant un tour, ses
    /// traces sont numérotées dans l'ordre de leur date, puis de leur nom.
    pub fn set_collection_tour(&mut self, id: i64, is_tour: bool) -> Result<()> {
        self.conn.execute("UPDATE collections SET is_tour = ?2 WHERE id = ?1", params![id, is_tour])?;
        if is_tour {
            let stages = self.list(&TraceFilter { collection: Some(id), ..Default::default() })?;
            let mut rows: Vec<(i64, i64, String)> = Vec::new();
            for t in stages {
                let date: i64 = self.conn.query_row(
                    "SELECT COALESCE(gpx_date, file_mtime) FROM traces WHERE id = ?1",
                    [t.id],
                    |r| r.get(0),
                )?;
                rows.push((t.id, date, t.name));
            }
            rows.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| natural_cmp(&a.2, &b.2)));
            let ids: Vec<i64> = rows.into_iter().map(|r| r.0).collect();
            self.set_tour_order(id, &ids)?;
        }
        Ok(())
    }

    /// Étapes d'un tour, dans l'ordre.
    pub fn tour_stages(&self, id: i64) -> Result<Vec<TraceDetail>> {
        let mut st = self
            .conn
            .prepare("SELECT trace_id FROM collection_traces WHERE collection_id = ?1 ORDER BY position, trace_id")?;
        let ids = st.query_map([id], |r| r.get(0))?.collect::<std::result::Result<Vec<i64>, _>>()?;
        ids.into_iter().map(|t| self.get(t)).collect()
    }

    /// Nouvel ordre des étapes (les traces absentes de la liste gardent leur place, à la fin).
    pub fn set_tour_order(&mut self, id: i64, ordered: &[i64]) -> Result<()> {
        let tx = self.conn.transaction()?;
        for (i, t) in ordered.iter().enumerate() {
            tx.execute(
                "UPDATE collection_traces SET position = ?3 WHERE collection_id = ?1 AND trace_id = ?2",
                params![id, t, i as i64 + 1],
            )?;
        }
        tx.execute(
            "UPDATE collection_traces SET position = position + ?2 WHERE collection_id = ?1
               AND trace_id NOT IN (SELECT value FROM json_each(?3))",
            params![id, ordered.len() as i64, serde_json::to_string(ordered)?],
        )?;
        tx.commit()?;
        Ok(())
    }
}

impl Index {
    /// Identifiants déjà importés depuis un service (ex. « komoot »).
    pub fn external_imports(&self, source: &str) -> Result<std::collections::HashSet<String>> {
        let mut st = self.conn.prepare("SELECT external_id FROM external_imports WHERE source = ?1")?;
        let ids = st.query_map([source], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        Ok(ids)
    }

    pub fn mark_external_import(&self, source: &str, external_id: &str, path: &str, now: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO external_imports(source, external_id, path, imported_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(source, external_id) DO UPDATE SET path = excluded.path, imported_at = excluded.imported_at",
            params![source, external_id, path, now],
        )?;
        Ok(())
    }
}

impl Index {
    /// Identifiant du parcours déjà envoyé vers un service (pour le mettre à jour).
    pub fn device_send(&self, trace_id: i64, service: &str) -> Result<Option<(String, i64)>> {
        Ok(self
            .conn
            .query_row(
                "SELECT external_id, sent_at FROM device_sends WHERE trace_id = ?1 AND service = ?2",
                params![trace_id, service],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }

    pub fn set_device_send(&self, trace_id: i64, service: &str, external_id: &str, now: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO device_sends(trace_id, service, external_id, sent_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(trace_id, service) DO UPDATE SET external_id = excluded.external_id, sent_at = excluded.sent_at",
            params![trace_id, service, external_id, now],
        )?;
        Ok(())
    }

    pub fn clear_device_send(&self, trace_id: i64, service: &str) -> Result<()> {
        self.conn.execute("DELETE FROM device_sends WHERE trace_id = ?1 AND service = ?2", params![trace_id, service])?;
        Ok(())
    }
}

impl Index {
    /// Taille et date connues d'un entraînement (pour ne pas relire un fichier inchangé).
    pub fn workout_state(&self, path: &str) -> Result<Option<(i64, i64)>> {
        Ok(self
            .conn
            .query_row("SELECT file_size, file_mtime FROM workouts WHERE path = ?1", [path], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?)
    }

    pub fn upsert_workout(
        &self,
        library_id: i64,
        path: &str,
        size: i64,
        mtime: i64,
        w: &crate::workout::Workout,
        now: i64,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO workouts(library_id, path, file_size, file_mtime, name, author, description, sport, tags_json,
                                  duration, intensity, tss, blocks_json, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(path) DO UPDATE SET library_id = excluded.library_id, file_size = excluded.file_size,
               file_mtime = excluded.file_mtime, name = excluded.name, author = excluded.author,
               description = excluded.description, sport = excluded.sport, tags_json = excluded.tags_json,
               duration = excluded.duration, intensity = excluded.intensity, tss = excluded.tss,
               blocks_json = excluded.blocks_json",
            params![
                library_id,
                path,
                size,
                mtime,
                w.name,
                w.author,
                w.description,
                w.sport,
                serde_json::to_string(&w.tags)?,
                w.duration,
                w.intensity,
                w.tss,
                serde_json::to_string(&w.blocks)?,
                now
            ],
        )?;
        Ok(self.conn.query_row("SELECT id FROM workouts WHERE path = ?1", [path], |r| r.get(0))?)
    }

    /// Retire de l'index les entraînements d'une bibliothèque qui n'ont pas été revus.
    pub fn remove_missing_workouts(&self, library_id: i64, seen: &std::collections::HashSet<String>) -> Result<usize> {
        let mut st = self.conn.prepare("SELECT id, path FROM workouts WHERE library_id = ?1")?;
        let rows: Vec<(i64, String)> =
            st.query_map([library_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
        let mut n = 0;
        for (id, path) in rows {
            if !seen.contains(&path) {
                self.conn.execute("DELETE FROM workouts WHERE id = ?1", [id])?;
                n += 1;
            }
        }
        Ok(n)
    }

    /// Tous les entraînements, les plus récemment ajoutés d'abord.
    pub fn workouts(&self) -> Result<Vec<WorkoutSummary>> {
        self.query_workouts("", [])
    }

    /// Entraînements, filtrés par une clause SQL (`WHERE …`) facultative.
    fn query_workouts(&self, filter: &str, args: impl rusqlite::Params) -> Result<Vec<WorkoutSummary>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT id, library_id, path, name, author, description, sport, tags_json, duration, intensity, tss,
                    blocks_json, added_at FROM workouts {filter} ORDER BY added_at DESC, name COLLATE NATUREL"
        ))?;
        let rows = st.query_map(args, |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, u32>(8)?,
                r.get::<_, f64>(9)?,
                r.get::<_, f64>(10)?,
                r.get::<_, String>(11)?,
                r.get::<_, i64>(12)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, library_id, path, name, author, description, sport, tags, duration, intensity, tss, blocks, added_at) = row?;
            out.push(WorkoutSummary {
                id,
                library_id,
                path,
                workout: crate::workout::Workout {
                    name,
                    author,
                    description,
                    sport,
                    tags: serde_json::from_str(&tags).unwrap_or_default(),
                    duration,
                    intensity,
                    tss,
                    blocks: serde_json::from_str(&blocks).unwrap_or_default(),
                },
                added_at,
            });
        }
        Ok(out)
    }

    pub fn workout(&self, id: i64) -> Result<WorkoutSummary> {
        self.query_workouts("WHERE id = ?1", [id])?.into_iter().next().ok_or_else(|| Error::NotFound(format!("entraînement {id}")))
    }
}

impl Index {
    pub fn workout_send(&self, workout_id: i64, service: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT external_id FROM workout_sends WHERE workout_id = ?1 AND service = ?2",
                params![workout_id, service],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn set_workout_send(&self, workout_id: i64, service: &str, external_id: &str, now: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO workout_sends(workout_id, service, external_id, sent_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(workout_id, service) DO UPDATE SET external_id = excluded.external_id, sent_at = excluded.sent_at",
            params![workout_id, service, external_id, now],
        )?;
        Ok(())
    }

    /// Entraînements déjà envoyés vers ce service.
    pub fn workouts_sent(&self, service: &str) -> Result<Vec<i64>> {
        let mut st = self.conn.prepare("SELECT workout_id FROM workout_sends WHERE service = ?1")?;
        let ids = st.query_map([service], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        Ok(ids)
    }
}
