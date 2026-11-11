//! Agenda Pédalons (https://www.pedalons.fr), par son API (contrat
//! `contracts/openapi.yaml` du dépôt de Pédalons) :
//!
//! - connexion : `POST /api/auth/login` (e-mail, mot de passe) renvoie un jeton
//!   d'accès ; le jeton de renouvellement arrive dans le cookie `refresh_token`.
//!   Ensuite `POST /api/auth/refresh` avec l'en-tête `X-Refresh-Token` (comme
//!   l'appli mobile) renvoie un nouveau jeton d'accès et un nouveau jeton de
//!   renouvellement, qui remplace l'ancien. Le mot de passe n'est jamais gardé ;
//!   seul le jeton de renouvellement l'est, dans le gestionnaire d'identifiants ;
//! - agenda : `GET /api/calendar/events` (sorties et étapes de voyage des équipes) ;
//! - parcours : la sortie (`/api/teams/{équipe}/rides/{sortie}`, un parcours par
//!   groupe) ou le voyage (`/api/teams/{équipe}/trips/{voyage}`, un par étape),
//!   puis le GPX : `GET /api/device/routes/{équipe}/{parcours}/gpx`.

use std::io::Read;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::http::agent;

const BASE: &str = "https://www.pedalons.fr";
const SERVICE: &str = "Organisons Pédalons";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Account {
    email: String,
    display_name: String,
    refresh_token: String,
}

/// Ce que l'interface voit du compte (jamais les jetons).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub email: String,
    pub display_name: String,
}

/// Une sortie ou une étape de voyage de l'agenda.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub start: String,
    /// « RIDE » ou « TRIP_STAGE ».
    pub kind: String,
    pub team_slug: String,
    pub team_name: String,
    pub entity_slug: String,
    pub trip_slug: Option<String>,
    pub start_place: Option<String>,
    pub distance_km: Option<f64>,
    pub elevation_gain: Option<f64>,
    /// Inscrit à cette sortie.
    pub registered: bool,
    pub group_name: Option<String>,
    pub finished: bool,
    /// Déjà importé dans Organisons.
    #[serde(default)]
    pub imported: bool,
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, "compte").map_err(|e| format!("Gestionnaire d'identifiants : {e}"))
}

fn load() -> Option<Account> {
    serde_json::from_str(&entry().ok()?.get_password().ok()?).ok()
}

fn save(a: &Account) -> Result<(), String> {
    entry()?.set_password(&serde_json::to_string(a).map_err(|e| e.to_string())?).map_err(|e| format!("Gestionnaire d'identifiants : {e}"))
}

/// Jeton d'accès en mémoire seulement, avec son heure d'expiration.
fn access_cache() -> &'static Mutex<Option<(String, Instant)>> {
    static C: Mutex<Option<(String, Instant)>> = Mutex::new(None);
    &C
}

fn http_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(401, _) => "Pédalons a refusé l'accès : reconnecte-toi dans Connexions → Pédalons.".into(),
        ureq::Error::Status(400, r) => crate::http::status("Pédalons (demande refusée)", 400, r),
        ureq::Error::Status(403, _) => "Pédalons a refusé l'accès (session expirée ou sortie privée) : reconnecte-toi si besoin.".into(),
        ureq::Error::Status(404, _) => "Pédalons ne trouve pas cette sortie ou ce parcours (supprimé ?).".into(),
        ureq::Error::Status(429, r) => {
            let wait = r.header("Retry-After").map(|s| format!(" (dans {s} s)")).unwrap_or_default();
            format!("Pédalons limite les essais : réessaie plus tard{wait}.")
        }
        ureq::Error::Status(code, r) => crate::http::status("Pédalons", code, r),
        ureq::Error::Transport(t) => crate::http::unreachable("Pédalons", t),
    }
}

fn read_json(resp: ureq::Response) -> Result<serde_json::Value, String> {
    let mut body = String::new();
    resp.into_reader().take(20 * 1024 * 1024).read_to_string(&mut body).map_err(|e| format!("Réponse de Pédalons illisible : {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("Réponse de Pédalons inattendue : {e}"))
}

/// Valeur du cookie `refresh_token` dans les en-têtes `Set-Cookie`.
fn refresh_cookie(resp: &ureq::Response) -> Option<String> {
    resp.all("set-cookie").into_iter().find_map(|c| {
        let first = c.split(';').next()?.trim();
        let (k, v) = first.split_once('=')?;
        (k.trim() == "refresh_token" && !v.trim().is_empty()).then(|| v.trim().to_string())
    })
}

fn remember_access(v: &serde_json::Value) -> Option<String> {
    let token = v["accessToken"].as_str()?.to_string();
    // Marge d'une minute avant l'expiration annoncée.
    let secs = v["expiresIn"].as_u64().unwrap_or(300).saturating_sub(60).max(30);
    *access_cache().lock().ok()? = Some((token.clone(), Instant::now() + Duration::from_secs(secs)));
    Some(token)
}

pub fn status() -> Option<AccountInfo> {
    load().map(|a| AccountInfo { email: a.email, display_name: a.display_name })
}

/// Connexion : le mot de passe sert une fois ; seul le jeton de renouvellement est gardé.
pub fn login(email: &str, password: &str) -> Result<AccountInfo, String> {
    let email = email.trim();
    if email.is_empty() || password.is_empty() {
        return Err("Renseigne l'adresse e-mail et le mot de passe de ton compte Pédalons.".into());
    }
    let body = serde_json::json!({ "email": email, "password": password }).to_string();
    let resp = agent()
        .post(&format!("{BASE}/api/auth/login"))
        .set("Content-Type", "application/json")
        .send_string(&body)
        .map_err(|e| match e {
            // Connexion : un refus, c'est l'adresse ou le mot de passe.
            ureq::Error::Status(400 | 401, _) => "Pédalons a refusé la connexion : vérifie l'adresse et le mot de passe.".to_string(),
            e => http_error(e),
        })?;
    let cookie = refresh_cookie(&resp);
    let v = read_json(resp)?;
    let refresh = v["refreshToken"].as_str().map(str::to_string).or(cookie).ok_or("Pédalons n'a pas renvoyé de jeton de renouvellement.")?;
    remember_access(&v).ok_or("Réponse de Pédalons sans jeton d'accès.")?;
    let display_name = v["user"]["displayName"].as_str().unwrap_or(email).to_string();
    let a = Account { email: email.into(), display_name, refresh_token: refresh };
    save(&a)?;
    Ok(AccountInfo { email: a.email, display_name: a.display_name })
}

pub fn logout() -> Result<(), String> {
    if let Ok(mut c) = access_cache().lock() {
        *c = None;
    }
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Gestionnaire d'identifiants : {e}")),
    }
}

/// Jeton d'accès valide : celui en mémoire, sinon un nouveau par le jeton de renouvellement.
fn access(force: bool) -> Result<String, String> {
    if !force {
        if let Some((t, until)) = access_cache().lock().map_err(|e| e.to_string())?.clone() {
            if Instant::now() < until {
                return Ok(t);
            }
        }
    }
    let mut a = load().ok_or("Pas connecté à Pédalons : connecte-toi dans Connexions → Pédalons.")?;
    let resp = agent()
        .post(&format!("{BASE}/api/auth/refresh"))
        .set("X-Refresh-Token", &a.refresh_token)
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(401 | 403, _) => "Session Pédalons expirée : reconnecte-toi dans Connexions → Pédalons.".to_string(),
            e => http_error(e),
        })?;
    let cookie = refresh_cookie(&resp);
    let v = read_json(resp)?;
    // Jeton de renouvellement tourné : le nouveau remplace l'ancien (absent pendant le délai de grâce).
    if let Some(next) = v["refreshToken"].as_str().map(str::to_string).or(cookie) {
        a.refresh_token = next;
        save(&a)?;
    }
    remember_access(&v).ok_or_else(|| "Réponse de Pédalons sans jeton d'accès.".to_string())
}

/// GET authentifié ; un refus 401 redemande un jeton d'accès une fois.
fn get(path: &str) -> Result<ureq::Response, String> {
    let url = format!("{BASE}{path}");
    match agent().get(&url).set("Authorization", &format!("Bearer {}", access(false)?)).call() {
        Err(ureq::Error::Status(401, _)) => {
            agent().get(&url).set("Authorization", &format!("Bearer {}", access(true)?)).call().map_err(http_error)
        }
        r => r.map_err(http_error),
    }
}

fn seg(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn opt_str(v: &serde_json::Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

/// Instant ISO 8601 complet attendu par Pédalons (`Instant.parse`) : une date seule
/// (AAAA-MM-JJ) devient minuit UTC, sinon c'est un refus 400.
fn instant(d: &str) -> String {
    let d = d.trim();
    if d.len() == 10 { format!("{d}T00:00:00Z") } else { d.to_string() }
}

/// Sorties et étapes des équipes entre deux dates (AAAA-MM-JJ), les plus proches d'abord.
pub fn events(from: &str, to: &str) -> Result<Vec<Event>, String> {
    let v = read_json(get(&format!("/api/calendar/events?from={}&to={}", seg(&instant(from)), seg(&instant(to))))?)?;
    let mut out: Vec<Event> = v["events"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|e| {
            Some(Event {
                id: opt_str(&e["id"])?,
                title: opt_str(&e["title"]).unwrap_or_else(|| "Sans titre".into()),
                start: opt_str(&e["start"]).unwrap_or_default(),
                kind: opt_str(&e["type"]).unwrap_or_else(|| "RIDE".into()),
                team_slug: opt_str(&e["teamSlug"])?,
                team_name: opt_str(&e["teamName"]).unwrap_or_default(),
                entity_slug: opt_str(&e["entitySlug"])?,
                trip_slug: opt_str(&e["tripSlug"]),
                start_place: opt_str(&e["startPlaceName"]),
                distance_km: e["distance"].as_f64().map(|m| m / 1000.0),
                elevation_gain: e["elevationGain"].as_f64(),
                registered: e["registered"].as_bool().unwrap_or(false),
                group_name: opt_str(&e["groupName"]),
                finished: e["finished"].as_bool().unwrap_or(false),
                imported: false,
            })
        })
        .collect();
    out.sort_by(|a, b| a.start.cmp(&b.start));
    Ok(out)
}

/// Parcours d'un événement : (identifiant, nom). Une sortie a un parcours par groupe
/// (celui de son groupe si on y est inscrit) ; une étape de voyage a le sien.
pub fn routes(e: &Event) -> Result<Vec<(String, String)>, String> {
    let team = seg(&e.team_slug);
    let mut out: Vec<(String, String)> = Vec::new();
    let mut push = |slug: Option<String>, label: String| {
        if let Some(s) = slug {
            if !out.iter().any(|(x, _)| *x == s) {
                out.push((s, label));
            }
        }
    };
    if e.kind == "TRIP_STAGE" {
        let trip = e.trip_slug.as_deref().ok_or("Étape sans voyage.")?;
        let v = read_json(get(&format!("/api/teams/{team}/trips/{}", seg(trip)))?)?;
        for s in v["stages"].as_array().cloned().unwrap_or_default() {
            if s["slug"].as_str() == Some(e.entity_slug.as_str()) {
                push(opt_str(&s["route"]["slug"]).or_else(|| opt_str(&s["routeSlug"])), e.title.clone());
            }
        }
    } else {
        let v = read_json(get(&format!("/api/teams/{team}/rides/{}", seg(&e.entity_slug)))?)?;
        let groups = v["groups"].as_array().cloned().unwrap_or_default();
        let mine: Vec<&serde_json::Value> = groups.iter().filter(|g| g["registered"].as_bool() == Some(true)).collect();
        let chosen = if mine.is_empty() { groups.iter().collect::<Vec<_>>() } else { mine };
        for g in chosen {
            let label = match g["name"].as_str() {
                Some(n) if groups.len() > 1 => format!("{} – {n}", e.title),
                _ => e.title.clone(),
            };
            push(opt_str(&g["routeSlug"]), label);
        }
        push(opt_str(&v["routeSlug"]), e.title.clone());
    }
    if out.is_empty() {
        return Err(format!("« {} » n'a pas encore de parcours sur Pédalons.", e.title));
    }
    Ok(out)
}

/// Télécharge le GPX d'un parcours.
pub fn download(team_slug: &str, route_slug: &str, dest: &Path) -> Result<(), String> {
    let resp = get(&format!("/api/device/routes/{}/{}/gpx", seg(team_slug), seg(route_slug)))?;
    let mut bytes = Vec::new();
    resp.into_reader().take(100 * 1024 * 1024).read_to_end(&mut bytes).map_err(|e| format!("Téléchargement interrompu : {e}"))?;
    if !bytes.windows(4).any(|w| w == b"<gpx") {
        return Err("Pédalons n'a pas renvoyé de GPX.".into());
    }
    std::fs::write(dest, &bytes).map_err(|e| format!("{} : {e}", dest.display()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn segments_d_url() {
        assert_eq!(super::seg("sortie du 12/11"), "sortie%20du%2012%2F11");
        assert_eq!(super::seg("2026-11-11T00:00:00Z"), "2026-11-11T00%3A00%3A00Z");
        assert_eq!(super::instant("2026-11-11"), "2026-11-11T00:00:00Z");
        assert_eq!(super::instant("2026-11-11T08:00:00Z"), "2026-11-11T08:00:00Z");
    }
}
