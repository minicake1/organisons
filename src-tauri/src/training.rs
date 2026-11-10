//! Envoi des entraînements (.zwo) vers les plateformes d'entraînement.
//!
//! - **Zwift** : pas d'API ; Zwift lit les séances personnelles dans
//!   `Documents\Zwift\Workouts\<identifiant Zwift>\` (le dossier Documents peut
//!   être dans OneDrive). Organisons y copie le fichier.
//! - **intervals.icu** : API officielle avec une clé personnelle (Réglages →
//!   Developer Settings d'intervals.icu), authentification `API_KEY:<clé>`.
//!   La séance est posée à une date du calendrier ; intervals.icu peut ensuite la
//!   renvoyer vers d'autres services (Zwift, Garmin, MyWhoosh…).

use crate::http::agent;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

// ---- Zwift ---------------------------------------------------------------

/// Dossiers de séances Zwift (un par identifiant) trouvés sous le dossier Documents.
pub fn zwift_folders(documents: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut bases = vec![documents.join("Zwift").join("Workouts")];
    // Documents déplacé dans OneDrive, ou l'inverse.
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home = PathBuf::from(home);
        bases.push(home.join("Documents").join("Zwift").join("Workouts"));
        bases.push(home.join("OneDrive").join("Documents").join("Zwift").join("Workouts"));
    }
    for base in bases {
        let Ok(entries) = std::fs::read_dir(&base) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            let numeric = p.file_name().map(|n| n.to_string_lossy().chars().all(|c| c.is_ascii_digit())).unwrap_or(false);
            if p.is_dir() && numeric {
                let s = p.to_string_lossy().to_string();
                if !out.contains(&s) {
                    out.push(s);
                }
            }
        }
    }
    // Le plus long identifiant d'abord (le vrai compte plutôt qu'un dossier « 1 »).
    out.sort_by_key(|p| std::cmp::Reverse(Path::new(p).file_name().map(|n| n.len()).unwrap_or(0)));
    out
}

/// Copie une séance dans le dossier Zwift (même nom : remplacée, donc mise à jour).
pub fn send_to_zwift(folder: &str, name: &str, source: &Path) -> Result<String, String> {
    let dir = Path::new(folder);
    if !dir.is_dir() {
        return Err(format!("Dossier Zwift introuvable : {folder}"));
    }
    let file = format!("{}.zwo", traces_core::organize::sanitize(name));
    let to = dir.join(file);
    std::fs::copy(source, &to).map_err(|e| format!("{} : copie impossible ({e})", to.display()))?;
    Ok(to.to_string_lossy().to_string())
}

// ---- intervals.icu -------------------------------------------------------

const ICU: &str = "https://intervals.icu/api/v1";
const SERVICE: &str = "Organisons intervals.icu";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IcuAccount {
    athlete_id: String,
    api_key: String,
    name: String,
}

/// Ce que l'interface voit du compte intervals.icu (jamais la clé).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IcuStatus {
    pub connected: bool,
    pub athlete_id: String,
    pub name: String,
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, "compte").map_err(|e| format!("Gestionnaire d'identifiants : {e}"))
}

fn load() -> Option<IcuAccount> {
    serde_json::from_str(&entry().ok()?.get_password().ok()?).ok()
}


fn auth(key: &str) -> String {
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("API_KEY:{key}")))
}

fn http_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(401 | 403, _) => "intervals.icu a refusé l'accès : vérifie l'identifiant d'athlète et la clé d'API.".into(),
        ureq::Error::Status(404, _) => "intervals.icu ne trouve pas cet athlète (identifiant du type i123456).".into(),
        ureq::Error::Status(429, _) => "intervals.icu limite les requêtes : réessaie dans quelques minutes.".into(),
        ureq::Error::Status(code, r) => crate::http::status("intervals.icu", code, r),
        ureq::Error::Transport(t) => crate::http::unreachable("intervals.icu", t),
    }
}

pub fn icu_status() -> IcuStatus {
    match load() {
        Some(a) => IcuStatus { connected: true, athlete_id: a.athlete_id, name: a.name },
        None => IcuStatus { connected: false, athlete_id: String::new(), name: String::new() },
    }
}

/// Vérifie l'identifiant et la clé auprès d'intervals.icu, puis les enregistre.
pub fn icu_connect(athlete_id: &str, api_key: &str) -> Result<IcuStatus, String> {
    let id = athlete_id.trim();
    let key = api_key.trim();
    if id.is_empty() || key.is_empty() {
        return Err("Renseigne l'identifiant d'athlète et la clé d'API.".into());
    }
    let resp = agent().get(&format!("{ICU}/athlete/{id}")).set("Authorization", &auth(key)).call().map_err(http_error)?;
    let v: serde_json::Value = serde_json::from_str(&resp.into_string().unwrap_or_default()).unwrap_or_default();
    let name = v["name"].as_str().unwrap_or(id).to_string();
    let account = IcuAccount { athlete_id: id.into(), api_key: key.into(), name };
    entry()?.set_password(&serde_json::to_string(&account).map_err(|e| e.to_string())?).map_err(|e| format!("Gestionnaire d'identifiants : {e}"))?;
    Ok(icu_status())
}

pub fn icu_disconnect() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Gestionnaire d'identifiants : {e}")),
    }
}

/// Pose une séance au calendrier intervals.icu (date AAAA-MM-JJ) ; renvoie l'identifiant de l'événement.
pub fn icu_plan(name: &str, zwo: &str, date: &str, sport: &str) -> Result<String, String> {
    let a = load().ok_or("Compte intervals.icu pas connecté : renseigne-le dans Connexions → Entraînement.")?;
    let valid = date.len() == 10 && date.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    if !valid {
        return Err("Date invalide (attendu AAAA-MM-JJ).".into());
    }
    let body = serde_json::json!({
        "category": "WORKOUT",
        "start_date_local": format!("{date}T00:00:00"),
        "type": if sport == "run" { "Run" } else { "Ride" },
        "name": name,
        "filename": format!("{}.zwo", traces_core::device::device_file_name(name)),
        "file_contents": zwo,
    });
    let resp = agent()
        .post(&format!("{ICU}/athlete/{}/events", a.athlete_id))
        .set("Authorization", &auth(&a.api_key))
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(http_error)?;
    let v: serde_json::Value = serde_json::from_str(&resp.into_string().unwrap_or_default()).unwrap_or_default();
    Ok(match &v["id"] {
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.clone(),
        _ => String::new(),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn authentification() {
        // « API_KEY:abc » en base64
        assert_eq!(super::auth("abc"), "Basic QVBJX0tFWTphYmM=");
    }
}
