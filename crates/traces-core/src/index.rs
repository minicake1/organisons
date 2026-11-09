//! Index SQLite local : bibliothèques, traces, tags, points d'intérêt.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{Error, Result};
use crate::model::*;

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
"#;

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
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    // ---- Bibliothèques -------------------------------------------------

    pub fn add_library(&self, name: &str, path: &str, mode: &str, pattern: &str) -> Result<Library> {
        self.conn.execute(
            "INSERT INTO libraries(name, path, mode, pattern) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET name = excluded.name, mode = excluded.mode, pattern = excluded.pattern",
            params![name, path, mode, pattern],
        )?;
        let id: i64 = self.conn.query_row("SELECT id FROM libraries WHERE path = ?1", [path], |r| r.get(0))?;
        Ok(Library { id, name: name.into(), path: path.into(), mode: mode.into(), pattern: pattern.into() })
    }

    pub fn libraries(&self) -> Result<Vec<Library>> {
        let mut st = self.conn.prepare("SELECT id, name, path, mode, pattern FROM libraries ORDER BY id")?;
        let rows = st.query_map([], |r| {
            Ok(Library { id: r.get(0)?, name: r.get(1)?, path: r.get(2)?, mode: r.get(3)?, pattern: r.get(4)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
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
        ];
        let id = if let Some(id) = existing {
            tx.execute(
                "UPDATE traces SET library_id=?1, path=?2, file_hash=?3, file_size=?4, file_mtime=?5, name=?6,
                 distance_km=?7, elevation_gain=?8, elevation_loss=?9, ele_min=?10, ele_max=?11, hilliness=?12,
                 wind=?13, source=?14, start_lat=?15, start_lon=?16, bbox_json=?17, point_count=?18, has_time=?19,
                 creator=?20, preview_json=?21, profile_json=?22 WHERE id = ?23",
                rusqlite::params_from_iter(values.iter().copied().chain(std::iter::once(&id as &dyn rusqlite::ToSql))),
            )?;
            tx.execute("DELETE FROM pois WHERE trace_id = ?1", [id])?;
            id
        } else {
            tx.execute(
                "INSERT INTO traces(library_id, path, file_hash, file_size, file_mtime, name, distance_km,
                 elevation_gain, elevation_loss, ele_min, ele_max, hilliness, wind, source, start_lat, start_lon,
                 bbox_json, point_count, has_time, creator, preview_json, profile_json, added_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
                rusqlite::params_from_iter(values.iter().copied().chain(std::iter::once(&added_at as &dyn rusqlite::ToSql))),
            )?;
            tx.last_insert_rowid()
        };
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
        let mut st = self.conn.prepare("SELECT DISTINCT tag FROM tags ORDER BY tag COLLATE NOCASE")?;
        let rows = st.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Liste filtrée et triée (filtres de la bibliothèque v0.1).
    pub fn list(&self, f: &TraceFilter) -> Result<Vec<TraceSummary>> {
        let mut sql = String::from(
            "SELECT t.id, t.library_id, t.path, t.name, t.distance_km, t.elevation_gain, t.hilliness, t.wind,
                    t.surface_type, t.source, t.added_at, t.preview_json,
                    (SELECT COUNT(*) FROM pois p WHERE p.trace_id = t.id),
                    (SELECT group_concat(tag, char(31)) FROM tags g WHERE g.trace_id = t.id)
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
        if let Some(s) = f.surface_type.as_deref().filter(|s| !s.is_empty()) {
            arg(&mut sql, &mut args, " AND t.surface_type = ?", Box::new(s.to_string()));
        }
        if let Some(s) = f.source.as_deref().filter(|s| !s.is_empty()) {
            arg(&mut sql, &mut args, " AND t.source = ?", Box::new(s.to_string()));
        }
        if let Some(tag) = f.tag.as_deref().filter(|s| !s.is_empty()) {
            arg(&mut sql, &mut args, " AND EXISTS (SELECT 1 FROM tags g WHERE g.trace_id = t.id AND g.tag = ?)", Box::new(tag.to_string()));
        }
        let dir = if f.ascending { "ASC" } else { "DESC" };
        sql.push_str(&match f.sort {
            SortKey::Date => format!(" ORDER BY t.added_at {dir}, t.id {dir}"),
            SortKey::Distance => format!(" ORDER BY t.distance_km {dir}"),
            SortKey::Elevation => format!(" ORDER BY t.elevation_gain {dir}"),
            SortKey::Hilliness => format!(" ORDER BY t.elevation_gain / MAX(t.distance_km, 0.001) {dir}"),
            SortKey::Name => format!(" ORDER BY t.name COLLATE NOCASE {dir}"),
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
                        t.elevation_loss, t.ele_min, t.ele_max, t.notes, t.has_time, t.creator, t.profile_json
                 FROM traces t WHERE t.id = ?1",
                [id],
                |r| {
                    Ok((
                        row_to_summary(r)?,
                        r.get::<_, f64>(14)?,
                        r.get::<_, f64>(15)?,
                        r.get::<_, f64>(16)?,
                        r.get::<_, String>(17)?,
                        r.get::<_, bool>(18)?,
                        r.get::<_, Option<String>>(19)?,
                        r.get::<_, String>(20)?,
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
        Ok(TraceDetail {
            summary,
            elevation_loss: loss,
            ele_min,
            ele_max,
            notes,
            has_time,
            creator,
            profile: serde_json::from_str(&profile_json)?,
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
        added_at: r.get(10)?,
        preview: serde_json::from_str(&preview).unwrap_or_default(),
        poi_count: r.get(12)?,
        tags: tags.map(|t| t.split('\u{1f}').map(String::from).collect()).unwrap_or_default(),
    })
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
