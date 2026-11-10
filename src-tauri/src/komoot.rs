//! Komoot, par son API interne (celle de son site et de ses applis) : il n'y a
//! pas d'API publique, celle-ci peut changer ou cesser de fonctionner à tout
//! moment. Le mot de passe sert une seule fois à obtenir un jeton ; seul ce jeton
//! est gardé, dans le gestionnaire d'identifiants de Windows.

use std::io::Read;
use std::path::Path;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};

const API: &str = "https://api.komoot.de";
const KEYRING_SERVICE: &str = "Organisons Komoot";
const KEYRING_USER: &str = "compte";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub email: String,
    pub user_id: String,
    pub token: String,
    pub display_name: String,
}

/// Ce que l'interface voit du compte (jamais le jeton).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub email: String,
    pub display_name: String,
}

impl From<&Account> for AccountInfo {
    fn from(a: &Account) -> Self {
        Self { email: a.email.clone(), display_name: a.display_name.clone() }
    }
}

/// Parcours du compte Komoot.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tour {
    pub id: String,
    pub name: String,
    /// "planned" (itinéraire préparé) ou "recorded" (sortie enregistrée)
    pub kind: String,
    pub sport: String,
    pub distance_km: f64,
    pub elevation_up: f64,
    pub date: Option<String>,
    /// Déjà importé dans Organisons.
    pub imported: bool,
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Gestionnaire d'identifiants : {e}"))
}

pub fn load() -> Option<Account> {
    let json = entry().ok()?.get_password().ok()?;
    serde_json::from_str(&json).ok()
}

pub fn logout() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Gestionnaire d'identifiants : {e}")),
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("Organisons/", env!("CARGO_PKG_VERSION")))
        .build()
}

fn basic(user: &str, password: &str) -> String {
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}")))
}

/// Message lisible pour une erreur HTTP de Komoot.
fn http_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(401 | 403, _) => "Komoot a refusé l'accès (adresse, mot de passe ou jeton expiré : reconnecte-toi).".into(),
        ureq::Error::Status(404, _) => "Komoot ne trouve pas ce parcours (supprimé ou privé ?).".into(),
        ureq::Error::Status(429, _) => "Komoot limite les requêtes : réessaie dans quelques minutes.".into(),
        ureq::Error::Status(code, _) => format!("Komoot a répondu {code} (son API interne a peut-être changé)."),
        ureq::Error::Transport(t) => format!("Komoot est injoignable (connexion internet ?) : {t}"),
    }
}

fn path_segment(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'@' | b'.' | b'_' | b'-' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn read_json(resp: ureq::Response) -> Result<serde_json::Value, String> {
    let mut body = String::new();
    resp.into_reader()
        .take(50 * 1024 * 1024)
        .read_to_string(&mut body)
        .map_err(|e| format!("Réponse de Komoot illisible : {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("Réponse de Komoot inattendue : {e}"))
}

/// Connexion : le mot de passe est échangé contre un jeton, gardé dans le
/// gestionnaire d'identifiants de Windows ; le mot de passe n'est pas conservé.
pub fn login(email: &str, password: &str) -> Result<Account, String> {
    let email = email.trim();
    let url = format!("{API}/v006/account/email/{}/", path_segment(email));
    let resp = agent().get(&url).set("Authorization", &basic(email, password)).call().map_err(http_error)?;
    let v = read_json(resp)?;
    let user_id = v["username"].as_str().ok_or("Réponse de Komoot sans identifiant d'utilisateur.")?;
    let token = v["password"].as_str().ok_or("Réponse de Komoot sans jeton.")?;
    let display_name = v["user"]["displayname"].as_str().unwrap_or(email).to_string();
    let account = Account { email: email.into(), user_id: user_id.into(), token: token.into(), display_name };
    let json = serde_json::to_string(&account).map_err(|e| e.to_string())?;
    entry()?.set_password(&json).map_err(|e| format!("Gestionnaire d'identifiants : {e}"))?;
    Ok(account)
}

/// Tous les parcours du compte (préparés et réalisés), les plus récents d'abord.
pub fn tours(account: &Account, mut on_page: impl FnMut(usize)) -> Result<Vec<Tour>, String> {
    let mut out = Vec::new();
    for page in 0..100 {
        let url = format!("{API}/v007/users/{}/tours/?page={page}&limit=100&sort_field=date&sort_direction=desc", account.user_id);
        let resp = agent().get(&url).set("Authorization", &basic(&account.user_id, &account.token)).call().map_err(http_error)?;
        let v = read_json(resp)?;
        let list = v["_embedded"]["tours"].as_array().cloned().unwrap_or_default();
        for t in &list {
            let id = match &t["id"] {
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::String(s) => s.clone(),
                _ => continue,
            };
            out.push(Tour {
                id,
                name: t["name"].as_str().unwrap_or("Sans nom").to_string(),
                kind: if t["type"].as_str() == Some("tour_recorded") { "recorded" } else { "planned" }.into(),
                sport: t["sport"].as_str().unwrap_or("").to_string(),
                distance_km: t["distance"].as_f64().unwrap_or(0.0) / 1000.0,
                elevation_up: t["elevation_up"].as_f64().unwrap_or(0.0),
                date: t["date"].as_str().map(str::to_string),
                imported: false,
            });
        }
        on_page(out.len());
        let total_pages = v["page"]["totalPages"].as_u64().unwrap_or(0);
        if list.is_empty() || page + 1 >= total_pages {
            break;
        }
    }
    Ok(out)
}

/// Télécharge le GPX d'un parcours.
pub fn download(account: &Account, id: &str, dest: &Path) -> Result<(), String> {
    let url = format!("{API}/v007/tours/{}.gpx", path_segment(id));
    let resp = agent().get(&url).set("Authorization", &basic(&account.user_id, &account.token)).call().map_err(http_error)?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(100 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Téléchargement interrompu : {e}"))?;
    if !bytes.windows(4).any(|w| w == b"<gpx") {
        return Err("Komoot n'a pas renvoyé de GPX.".into());
    }
    std::fs::write(dest, &bytes).map_err(|e| format!("{} : {e}", dest.display()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn adresse_dans_l_url() {
        assert_eq!(super::path_segment("jean.dupont+velo@exemple.fr"), "jean.dupont%2Bvelo@exemple.fr");
    }
}
