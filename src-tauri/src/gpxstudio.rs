//! Modification d'une trace dans gpx.studio, et dossier surveillé pour le retour.
//!
//! - **Aller** : gpx.studio (`/app?files=[url]`) sait ouvrir un GPX depuis une
//!   adresse. Organisons sert la trace sur `http://127.0.0.1:<port>/<jeton>/<nom>.gpx`,
//!   à gpx.studio seulement (CORS) et pendant 15 minutes. L'adresse ne contient
//!   qu'un jeton au hasard, jamais le chemin du fichier.
//! - **Retour** : gpx.studio n'enregistre pas ailleurs que dans le navigateur ;
//!   l'export arrive dans un dossier (Téléchargements par défaut). Organisons y
//!   repère les GPX arrivés depuis sa mise en service et propose de remplacer la
//!   trace modifiée ou de les ajouter à une bibliothèque. Le dossier sert aussi
//!   pour tout GPX exporté d'un autre site.

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use traces_core::{organize, Index, ImportCheck};

const ORIGIN: &str = "https://gpx.studio";
const LIFETIME: Duration = Duration::from_secs(15 * 60);

// ---- Aller : serveur local ------------------------------------------------

struct Shared {
    path: PathBuf,
    expires: Instant,
}

fn shares() -> &'static Mutex<HashMap<String, Shared>> {
    static S: OnceLock<Mutex<HashMap<String, Shared>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Port du serveur local, démarré à la première utilisation (port libre au hasard).
fn port() -> Result<u16, String> {
    static PORT: OnceLock<u16> = OnceLock::new();
    if let Some(p) = PORT.get() {
        return Ok(*p);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("Serveur local impossible : {e}"))?;
    let p = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || serve(stream));
        }
    });
    Ok(*PORT.get_or_init(|| p))
}

fn token() -> String {
    let mut out = String::new();
    for i in 0..2u8 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        h.write_u8(i);
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

fn serve(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let mut lines = req.lines();
    let first = lines.next().unwrap_or_default();
    let mut parts = first.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/"));
    let origin = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("origin"))
        .map(|(_, v)| v.trim().to_string());
    let cors = format!(
        "Access-Control-Allow-Origin: {ORIGIN}\r\nAccess-Control-Allow-Methods: GET\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n"
    );
    let reply = |stream: &mut TcpStream, status: &str, extra: &str, body: &[u8]| {
        let _ = write!(stream, "HTTP/1.1 {status}\r\n{cors}{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
        let _ = stream.write_all(body);
    };
    // Seul gpx.studio (ou une ouverture directe, sans origine) peut lire la trace.
    if origin.as_deref().is_some_and(|o| o != ORIGIN) {
        return reply(&mut stream, "403 Forbidden", "", b"");
    }
    if method == "OPTIONS" {
        return reply(&mut stream, "204 No Content", "", b"");
    }
    let key = target.trim_start_matches('/').split('/').next().unwrap_or("").to_string();
    let path = {
        let mut map = shares().lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, s| s.expires > Instant::now());
        map.get(&key).map(|s| s.path.clone())
    };
    match path.and_then(|p| std::fs::read(p).ok()) {
        Some(bytes) if method == "GET" => reply(&mut stream, "200 OK", "Content-Type: application/gpx+xml\r\n", &bytes),
        _ => reply(&mut stream, "404 Not Found", "", b""),
    }
}

/// Une modification en cours dans gpx.studio (gardée dans les réglages, pour le retour).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Session {
    trace_id: i64,
    /// Nom du fichier servi, sans `.gpx` : l'export de gpx.studio le reprend.
    stem: String,
    opened_at: i64,
}

const SESSIONS_KEY: &str = "gpxstudio_sessions";

fn sessions(index: &Index) -> Vec<Session> {
    index.setting(SESSIONS_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_sessions(index: &Index, list: &[Session]) -> Result<(), String> {
    index.set_setting(SESSIONS_KEY, &serde_json::to_string(list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Prépare l'ouverture d'une trace dans gpx.studio ; renvoie l'adresse à ouvrir.
pub fn open(index: &Index, trace_id: i64, now: i64) -> Result<String, String> {
    let t = index.get(trace_id).map_err(|e| e.to_string())?;
    let path = PathBuf::from(&t.summary.path);
    if !path.is_file() {
        return Err("Fichier injoignable (NAS éteint ?) : impossible de l'ouvrir dans gpx.studio.".into());
    }
    let stem = traces_core::device::device_file_name(&t.summary.name);
    let key = token();
    shares().lock().map_err(|e| e.to_string())?.insert(key.clone(), Shared { path, expires: Instant::now() + LIFETIME });
    let url = format!("http://127.0.0.1:{}/{key}/{}.gpx", port()?, enc(&stem));
    // Une seule modification suivie par trace, la plus récente ; au plus 20.
    let mut list: Vec<Session> = sessions(index).into_iter().filter(|s| s.trace_id != trace_id).collect();
    list.push(Session { trace_id, stem, opened_at: now });
    let excess = list.len().saturating_sub(20);
    list.drain(..excess);
    save_sessions(index, &list)?;
    let files = serde_json::to_string(&[url]).map_err(|e| e.to_string())?;
    Ok(format!("{ORIGIN}/fr/app?files={}", enc(&files)))
}

// ---- Retour : dossier surveillé ------------------------------------------

const DIR_KEY: &str = "inbox_dir";
const SINCE_KEY: &str = "inbox_since";
const DONE_KEY: &str = "inbox_done";

/// Trace dont un fichier du dossier est probablement la version modifiée.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditOf {
    pub trace_id: i64,
    pub name: String,
    /// La bibliothèque autorise l'écriture : « Remplacer » est possible.
    pub can_replace: bool,
}

/// GPX arrivé dans le dossier surveillé.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub path: String,
    pub file: String,
    pub modified: i64,
    pub check: ImportCheck,
    pub edit_of: Option<EditOf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inbox {
    pub dir: String,
    pub items: Vec<InboxItem>,
    /// Une modification gpx.studio attend son retour : l'interface regarde plus souvent.
    pub waiting: bool,
}

fn mtime(p: &Path) -> i64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn done_key(path: &str, modified: i64) -> String {
    format!("{modified}|{}", path.to_lowercase())
}

fn done(index: &Index) -> Vec<String> {
    index.setting(DONE_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// Note des fichiers comme traités (remplacés, ajoutés ou ignorés) : ils ne sont plus proposés.
pub fn mark_done(index: &Index, paths: &[String]) -> Result<(), String> {
    let mut list = done(index);
    for p in paths {
        let k = done_key(p, mtime(Path::new(p)));
        if !list.contains(&k) {
            list.push(k);
        }
    }
    let excess = list.len().saturating_sub(500);
    list.drain(..excess);
    index.set_setting(DONE_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn dir(index: &Index, default: &Path) -> String {
    index.setting(DIR_KEY).ok().flatten().filter(|d| !d.trim().is_empty()).unwrap_or_else(|| default.to_string_lossy().to_string())
}

pub fn set_dir(index: &Index, dir: &str) -> Result<(), String> {
    if !Path::new(dir).is_dir() {
        return Err(format!("Dossier introuvable : {dir}"));
    }
    index.set_setting(DIR_KEY, dir).map_err(|e| e.to_string())
}

/// Le fichier téléchargé porte-t-il le nom servi à gpx.studio ? Nom identique,
/// ou suivi d'un numéro ajouté par le navigateur (« nom (1) », « nom(2) »).
fn same_stem(file_stem: &str, served: &str) -> bool {
    let (f, s) = (file_stem.to_lowercase(), served.to_lowercase());
    match f.strip_prefix(&s) {
        Some("") => true,
        Some(rest) => {
            let rest = rest.trim_start();
            rest.len() > 2 && rest.starts_with('(') && rest.ends_with(')') && rest[1..rest.len() - 1].chars().all(|c| c.is_ascii_digit())
        }
        None => false,
    }
}

/// Analyses déjà faites (chemin, date) → résultat, gardées une minute : le bandeau
/// interroge le dossier toutes les 5 s pendant une modification gpx.studio.
fn check_cache() -> &'static Mutex<HashMap<(String, i64), (Instant, ImportCheck)>> {
    static C: OnceLock<Mutex<HashMap<(String, i64), (Instant, ImportCheck)>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// GPX du dossier surveillé arrivés depuis la mise en service, pas encore traités.
/// Ceux qui sont identiques à une trace de la bibliothèque sont écartés d'office.
/// L'index n'est pris que par moments courts : les fichiers sont analysés sans lui.
pub fn list(shared: &Mutex<Index>, default_dir: &Path, now: i64) -> Result<Inbox, String> {
    let lock = || shared.lock().map_err(|e| e.to_string());
    let (dir, since, sessions, done) = {
        let index = lock()?;
        let dir = dir(&index, default_dir);
        // Première utilisation : les fichiers déjà là sont ignorés.
        let since = match index.setting(SINCE_KEY).map_err(|e| e.to_string())?.and_then(|s| s.parse::<i64>().ok()) {
            Some(s) => s,
            None => {
                index.set_setting(SINCE_KEY, &now.to_string()).map_err(|e| e.to_string())?;
                now
            }
        };
        (dir, since, sessions(&index), done(&index).into_iter().collect::<HashSet<String>>())
    };
    let waiting = sessions.iter().any(|s| now - s.opened_at < 3 * 3600);
    let mut files: Vec<(PathBuf, i64)> = std::fs::read_dir(&dir)
        .map(|it| {
            it.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case("gpx")))
                .map(|p| {
                    let m = mtime(&p);
                    (p, m)
                })
                .filter(|(p, m)| *m >= since && !done.contains(&done_key(&p.to_string_lossy(), *m)))
                .collect()
        })
        .unwrap_or_default();
    files.sort_by_key(|f| std::cmp::Reverse(f.1));
    files.truncate(30);
    if files.is_empty() {
        return Ok(Inbox { dir, items: vec![], waiting });
    }

    // Comparaison avec la bibliothèque : l'analyse des fichiers se fait index libéré.
    let mut checks: Vec<(PathBuf, i64, ImportCheck)> = Vec::new();
    let mut todo = Vec::new();
    {
        let mut cache = check_cache().lock().map_err(|e| e.to_string())?;
        cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
        for (p, m) in files {
            match cache.get(&(p.to_string_lossy().to_string(), m)) {
                Some((_, c)) => checks.push((p, m, c.clone())),
                None => todo.push((p, m)),
            }
        }
    }
    if !todo.is_empty() {
        let (existing, hashes) = {
            let index = lock()?;
            (
                index.list(&traces_core::TraceFilter::default()).map_err(|e| e.to_string())?,
                index.names_by_hash_all().map_err(|e| e.to_string())?,
            )
        };
        let same = |h: &str| -> traces_core::Result<Vec<String>> { Ok(hashes.get(h).cloned().unwrap_or_default()) };
        let mut cache = check_cache().lock().map_err(|e| e.to_string())?;
        for (p, m) in todo {
            let path = p.to_string_lossy().to_string();
            let Some(c) = organize::check_import_with(std::slice::from_ref(&path), &existing, &same)
                .map_err(|e| e.to_string())?
                .into_iter()
                .next()
            else {
                continue;
            };
            cache.insert((path, m), (Instant::now(), c.clone()));
            checks.push((p, m, c));
        }
    }
    checks.sort_by_key(|c| std::cmp::Reverse(c.1));

    let index = lock()?;
    let mut items = Vec::new();
    let mut identical = Vec::new();
    for (p, modified, check) in checks {
        let path = p.to_string_lossy().to_string();
        if check.status == "identical" {
            identical.push(path);
            continue;
        }
        let file = p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        let stem = p.file_stem().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        // Export d'une trace ouverte dans gpx.studio : même nom que celui servi.
        let edit = sessions
            .iter()
            .rev()
            .find(|s| modified >= s.opened_at - 60 && same_stem(&stem, &s.stem))
            .and_then(|s| index.get(s.trace_id).ok().map(|t| (s.trace_id, t)))
            .map(|(trace_id, t)| EditOf {
                trace_id,
                name: t.summary.name.clone(),
                can_replace: index.library(t.summary.library_id).map(|l| l.write_gpx).unwrap_or(false),
            });
        items.push(InboxItem { path, file, modified, check, edit_of: edit });
    }
    mark_done(&index, &identical)?;
    Ok(Inbox { dir, items, waiting })
}

/// La modification d'une trace est rentrée : elle n'est plus attendue.
pub fn close_session(index: &Index, trace_id: i64) -> Result<(), String> {
    let list: Vec<Session> = sessions(index).into_iter().filter(|s| s.trace_id != trace_id).collect();
    save_sessions(index, &list)
}

#[cfg(test)]
mod tests {
    #[test]
    fn meme_nom_que_celui_servi() {
        assert!(super::same_stem("BRM-600", "BRM-600"));
        assert!(super::same_stem("brm-600 (1)", "BRM-600"));
        assert!(super::same_stem("BRM-600(12)", "BRM-600"));
        assert!(!super::same_stem("BRM-600-Cotentin", "BRM-600"));
        assert!(!super::same_stem("BRM-600 ()", "BRM-600"));
    }

    #[test]
    fn adresse_gpx_studio() {
        let files = serde_json::to_string(&["http://127.0.0.1:5000/abc/BRM-600.gpx"]).unwrap();
        assert_eq!(super::enc(&files), "%5B%22http%3A%2F%2F127.0.0.1%3A5000%2Fabc%2FBRM-600.gpx%22%5D");
    }
}
