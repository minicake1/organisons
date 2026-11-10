//! Hammerhead (Karoo), par son API officielle (OAuth 2.0), comme Pédalons.
//!
//! L'utilisateur crée lui-même son application sur le Dashboard Hammerhead
//! (client ID, secret, adresse de retour locale). La connexion passe par le
//! navigateur : Organisons écoute un instant sur l'adresse de retour
//! (`http://localhost:<port>`), reçoit le code et l'échange contre un jeton.
//! Identifiants et jeton sont rangés dans le gestionnaire d'identifiants de Windows.

use crate::http::agent;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const AUTH_URL: &str = "https://api.hammerhead.io/v1/auth/oauth/authorize";
const TOKEN_URL: &str = "https://api.hammerhead.io/v1/auth/oauth/token";
const API: &str = "https://api.hammerhead.io/v1/api";
// Comme Pédalons : seulement l’envoi (une autorisation non prévue bloque la page de confirmation).
// Parcours et entraînements (.zwo). Ajouter une autorisation demande de reconnecter le compte.
const SCOPE: &str = "route:write workout:write";
const SERVICE: &str = "Organisons Hammerhead";
pub const DEFAULT_REDIRECT: &str = "http://localhost:3001";

/// Numéro de la tentative de connexion en cours : une nouvelle tentative arrête la précédente
/// (qui attend encore la réponse de Hammerhead et occupe le port de l’adresse de retour).
static ATTEMPT: AtomicU64 = AtomicU64::new(0);

/// Application Hammerhead de l'utilisateur.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Token {
    access_token: String,
    refresh_token: Option<String>,
    /// secondes Unix
    expires_at: Option<i64>,
}

/// Ce que l'interface voit (jamais le secret ni le jeton).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub configured: bool,
    pub client_id: String,
    pub redirect_uri: String,
    pub connected: bool,
    /// Application d’Organisons intégrée (rien à saisir, comme avec Pédalons).
    pub builtin: bool,
    pub builtin_available: bool,
}

fn entry(user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, user).map_err(|e| format!("Gestionnaire d'identifiants : {e}"))
}

fn load<T: for<'de> Deserialize<'de>>(user: &str) -> Option<T> {
    serde_json::from_str(&entry(user).ok()?.get_password().ok()?).ok()
}

fn save<T: Serialize>(user: &str, value: &T) -> Result<(), String> {
    let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
    entry(user)?.set_password(&json).map_err(|e| format!("Gestionnaire d'identifiants : {e}"))
}

fn forget(user: &str) -> Result<(), String> {
    match entry(user)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Gestionnaire d'identifiants : {e}")),
    }
}

/// Application Hammerhead intégrée à l’appli au build (`hammerhead.local.env`), comme celle de Pédalons.
fn builtin() -> Option<Client> {
    let id = option_env!("ORGANISONS_HAMMERHEAD_CLIENT_ID")?;
    let secret = option_env!("ORGANISONS_HAMMERHEAD_CLIENT_SECRET")?;
    Some(Client {
        client_id: id.into(),
        client_secret: secret.into(),
        redirect_uri: option_env!("ORGANISONS_HAMMERHEAD_REDIRECT_URI").unwrap_or(DEFAULT_REDIRECT).into(),
    })
}

/// Application utilisée : celle saisie dans les Réglages, sinon celle intégrée.
fn client() -> Option<Client> {
    load("client").or_else(builtin)
}

pub fn status() -> Status {
    let custom: Option<Client> = load("client");
    let client = custom.clone().or_else(builtin);
    Status {
        configured: client.is_some(),
        builtin: custom.is_none() && builtin().is_some(),
        builtin_available: builtin().is_some(),
        client_id: client.as_ref().map(|c| c.client_id.clone()).unwrap_or_default(),
        redirect_uri: client.as_ref().map(|c| c.redirect_uri.clone()).unwrap_or_else(|| DEFAULT_REDIRECT.into()),
        connected: load::<Token>("jeton").is_some(),
    }
}

/// Enregistre l'application ; un secret vide garde le secret déjà enregistré.
pub fn set_client(client_id: &str, client_secret: &str, redirect_uri: &str) -> Result<(), String> {
    let old: Option<Client> = load("client");
    let secret = if client_secret.trim().is_empty() {
        old.map(|c| c.client_secret).ok_or("Le secret client est vide.")?
    } else {
        client_secret.trim().to_string()
    };
    let redirect = redirect_uri.trim();
    if !(redirect.starts_with("http://localhost:") || redirect.starts_with("http://127.0.0.1:")) {
        return Err("L'adresse de retour doit être locale, par exemple http://localhost:3001".into());
    }
    // Un client ID Hammerhead est un identifiant (ex. 1a2b3c4d-5e6f-…), pas une adresse : le
    // remplissage automatique du navigateur y met parfois l’e-mail du compte.
    let id = client_id.trim();
    if id.contains('@') || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Le client ID ne ressemble pas à celui du Dashboard (ex. 1a2b3c4d-5e6f-…) : recopie-le depuis l’onglet « Réglages de l’API ».".into());
    }
    if client_id.trim().is_empty() {
        return Err("Le client ID est vide.".into());
    }
    save("client", &Client { client_id: client_id.trim().into(), client_secret: secret, redirect_uri: redirect.into() })
}

/// Abandonne la connexion en cours (libère le port de l’adresse de retour).
pub fn cancel() {
    ATTEMPT.fetch_add(1, Ordering::SeqCst);
}

/// Oublie l’application saisie dans les Réglages : l’application intégrée reprend la main.
pub fn reset_client() -> Result<(), String> {
    forget("client")?;
    forget("jeton")
}

pub fn disconnect() -> Result<(), String> {
    forget("jeton")
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}


fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn dec(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 2;
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn http_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(401 | 403, _) => "Hammerhead a refusé l'accès : reconnecte ton compte dans Connexions → Karoo.".into(),
        ureq::Error::Status(429, _) => "Hammerhead limite les requêtes : réessaie dans quelques minutes.".into(),
        ureq::Error::Status(code, r) => crate::http::status("Hammerhead", code, r),
        ureq::Error::Transport(t) => crate::http::unreachable("Hammerhead", t),
    }
}

fn token_request(form: &[(&str, &str)]) -> Result<Token, String> {
    let body = form.iter().map(|(k, v)| format!("{k}={}", enc(v))).collect::<Vec<_>>().join("&");
    let resp = agent()
        .post(TOKEN_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&body)
        .map_err(http_error)?;
    let v: serde_json::Value = serde_json::from_str(&resp.into_string().map_err(|e| e.to_string())?)
        .map_err(|e| format!("Réponse de Hammerhead inattendue : {e}"))?;
    let access = v["access_token"].as_str().ok_or("Réponse de Hammerhead sans jeton.")?;
    Ok(Token {
        access_token: access.into(),
        refresh_token: v["refresh_token"].as_str().map(str::to_string),
        expires_at: v["expires_in"].as_i64().map(|s| now() + s),
    })
}

/// Connexion du compte : ouvre la page d'autorisation (par `open`), attend le
/// retour sur l'adresse locale (5 minutes au plus) et enregistre le jeton.
pub fn connect(open: impl FnOnce(&str) -> Result<(), String>) -> Result<(), String> {
    let client: Client = client().ok_or("Aucune application Hammerhead : renseigne son client ID et son secret dans Connexions → Karoo (Avancé).")?;
    let port: u16 = client
        .redirect_uri
        .rsplit(':')
        .next()
        .and_then(|p| p.split('/').next())
        .and_then(|p| p.parse().ok())
        .ok_or("Adresse de retour sans port (ex. http://localhost:3001).")?;
    let attempt = ATTEMPT.fetch_add(1, Ordering::SeqCst) + 1;
    // La tentative précédente libère le port en moins d’une seconde.
    let mut bound = TcpListener::bind(("127.0.0.1", port));
    for _ in 0..20 {
        if bound.is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
        bound = TcpListener::bind(("127.0.0.1", port));
    }
    let listener = bound
        .map_err(|e| format!("Le port {port} de l'adresse de retour est déjà utilisé ({e}). Ferme le programme qui l'occupe, ou choisis un autre port (ici et sur le Dashboard Hammerhead)."))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    // « localhost » peut désigner ::1 (IPv6) selon le PC et le navigateur : on écoute
    // aussi là, si c'est possible, toujours en local seulement.
    let mut listeners = vec![listener];
    if let Ok(v6) = TcpListener::bind(("::1", port)) {
        if v6.set_nonblocking(true).is_ok() {
            listeners.push(v6);
        }
    }

    let mut h = RandomState::new().build_hasher();
    h.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let state = format!("{:016x}", h.finish());
    let url = format!(
        "{AUTH_URL}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={state}",
        enc(&client.client_id),
        enc(&client.redirect_uri),
        enc(SCOPE)
    );
    open(&url)?;

    let deadline = Instant::now() + Duration::from_secs(300);
    let (code, got_state) = loop {
        if ATTEMPT.load(Ordering::SeqCst) != attempt {
            return Err("Connexion remplacée par une nouvelle tentative.".into());
        }
        if Instant::now() > deadline {
            return Err("Pas de réponse de Hammerhead après 5 minutes : connexion abandonnée.".into());
        }
        let accepted = listeners
            .iter()
            .map(|l| l.accept())
            .find(|r| !matches!(r, Err(e) if e.kind() == std::io::ErrorKind::WouldBlock))
            .unwrap_or_else(|| Err(std::io::ErrorKind::WouldBlock.into()));
        match accepted {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let target = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let query = target.split_once('?').map(|q| q.1).unwrap_or("");
                let mut code = None;
                let mut st = None;
                let mut error = None;
                for pair in query.split('&') {
                    if let Some((k, v)) = pair.split_once('=') {
                        match k {
                            "code" => code = Some(dec(v)),
                            "state" => st = Some(dec(v)),
                            "error" => error = Some(dec(v)),
                            _ => {}
                        }
                    }
                }
                let ok = code.is_some();
                let page = if ok {
                    "Connexion à Hammerhead réussie. Tu peux fermer cet onglet et revenir à Organisons."
                } else {
                    "Connexion à Hammerhead refusée ou annulée. Tu peux fermer cet onglet."
                };
                let html = format!("<!doctype html><meta charset=utf-8><title>Organisons</title><body style=\"font-family:sans-serif;padding:3em\"><h2>Organisons</h2><p>{page}</p>");
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}", html.len());
                if let Some(e) = error {
                    return Err(format!("Hammerhead : autorisation refusée ({e})."));
                }
                if let Some(c) = code {
                    break (c, st);
                }
                // Autre requête (icône du site…) : on attend la bonne.
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(format!("Adresse de retour : {e}")),
        }
    };
    if got_state.as_deref() != Some(state.as_str()) {
        return Err("Réponse de Hammerhead inattendue (contrôle de sécurité) : recommence la connexion.".into());
    }
    let token = token_request(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &client.redirect_uri),
        ("client_id", &client.client_id),
        ("client_secret", &client.client_secret),
    ])?;
    save("jeton", &token)
}

/// Jeton valide, renouvelé s'il expire dans moins d'une minute.
fn access_token() -> Result<String, String> {
    let token: Token = load("jeton").ok_or("Compte Hammerhead pas connecté : connecte-le dans Connexions → Karoo.")?;
    if token.expires_at.is_none_or(|t| t > now() + 60) {
        return Ok(token.access_token);
    }
    let client: Client = client().ok_or("Application Hammerhead pas configurée.")?;
    let refresh = token.refresh_token.ok_or("Jeton Hammerhead expiré : reconnecte ton compte dans Connexions → Karoo.")?;
    let mut fresh = token_request(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh),
        ("client_id", &client.client_id),
        ("client_secret", &client.client_secret),
    ])?;
    if fresh.refresh_token.is_none() {
        fresh.refresh_token = Some(refresh);
    }
    save("jeton", &fresh)?;
    Ok(fresh.access_token)
}

/// Envoie un parcours (GPX préparé pour le Karoo). Avec `existing`, le parcours
/// déjà envoyé est remplacé ; s'il n'existe plus chez Hammerhead, il est recréé.
/// Renvoie l'identifiant du parcours chez Hammerhead.
pub fn send_route(name: &str, gpx: &[u8], existing: Option<&str>) -> Result<String, String> {
    send_file("routes", "gpx", "application/gpx+xml", name, gpx, existing)
}

/// Envoie un entraînement `.zwo` (même principe que les parcours).
pub fn send_workout(name: &str, zwo: &[u8], existing: Option<&str>) -> Result<String, String> {
    send_file("workouts", "zwo", "application/xml", name, zwo, existing)
}

fn send_file(kind: &str, ext: &str, mime: &str, name: &str, gpx: &[u8], existing: Option<&str>) -> Result<String, String> {
    let token = access_token()?;
    let mut h = RandomState::new().build_hasher();
    h.write_usize(gpx.len());
    let boundary = format!("----Organisons{:016x}", h.finish());
    let file = format!("{}.{ext}", traces_core::device::device_file_name(name));
    let body = traces_core::device::multipart_file(&boundary, &file, mime, gpx);
    let call = |method: &str, url: &str| {
        agent()
            .request(method, url)
            .set("Authorization", &format!("Bearer {token}"))
            .set("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
            .send_bytes(&body)
    };
    let resp = match existing {
        Some(id) => match call("PUT", &format!("{API}/{kind}/{id}/file")) {
            Err(ureq::Error::Status(404, _)) => call("POST", &format!("{API}/{kind}/file")),
            other => other,
        },
        None => call("POST", &format!("{API}/{kind}/file")),
    }
    .map_err(http_error)?;
    let v: serde_json::Value = serde_json::from_str(&resp.into_string().unwrap_or_default()).unwrap_or_default();
    Ok(match &v["id"] {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => existing.unwrap_or_default().to_string(),
    })
}

/// Retire du compte Hammerhead un parcours envoyé par Organisons.
pub fn delete_route(id: &str) -> Result<(), String> {
    let token = access_token()?;
    match agent().delete(&format!("{API}/routes/{id}")).set("Authorization", &format!("Bearer {token}")).call() {
        Ok(_) | Err(ureq::Error::Status(404, _)) => Ok(()),
        Err(e) => Err(http_error(e)),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn encodage() {
        assert_eq!(super::enc("http://localhost:3001"), "http%3A%2F%2Flocalhost%3A3001");
        assert_eq!(super::dec("abc%2Fd+e"), "abc/d e");
    }
}
