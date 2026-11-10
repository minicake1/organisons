//! Openrunner : import d'un parcours à partir de son lien. Pour un parcours
//! public, Openrunner fournit le GPX sans connexion
//! (`api.openrunner.com/api/v2/routes/<id>/export/gpx-track`) ; un parcours
//! privé est refusé et doit être exporté à la main depuis le site.

use std::io::Read;
use std::path::Path;
use std::time::Duration;

const API: &str = "https://api.openrunner.com/api/v2";

/// Identifiant d'un parcours dans un lien Openrunner (…/route-details/24118757,
/// …/route/24118757…) ou un identifiant seul.
pub fn route_id(input: &str) -> Option<String> {
    let s = input.trim();
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) {
        return Some(s.to_string());
    }
    if !s.to_lowercase().contains("openrunner") {
        return None;
    }
    // Le premier nombre d'au moins 4 chiffres après « route » dans l'adresse.
    let lower = s.to_lowercase();
    let from = lower.find("route").map(|i| i + 5).unwrap_or(0);
    let digits: String = s[from..]
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    (digits.len() >= 4).then_some(digits)
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("Organisons/", env!("CARGO_PKG_VERSION")))
        .build()
}

/// Télécharge le GPX (trace et points d'intérêt) d'un parcours public.
pub fn download(id: &str, dest: &Path) -> Result<(), String> {
    let url = format!("{API}/routes/{id}/export/gpx-track");
    let resp = agent().get(&url).call().map_err(|e| match e {
        ureq::Error::Status(401 | 403, _) => {
            "parcours privé : rends-le public sur Openrunner, ou exporte le GPX depuis le site et importe-le".to_string()
        }
        ureq::Error::Status(404, _) => "parcours introuvable sur Openrunner (lien erroné ou parcours supprimé)".into(),
        ureq::Error::Status(429, _) => "Openrunner limite les requêtes : réessaie dans quelques minutes".into(),
        ureq::Error::Status(code, _) => format!("Openrunner a répondu {code}"),
        ureq::Error::Transport(t) => format!("Openrunner est injoignable (connexion internet ?) : {t}"),
    })?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(100 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("téléchargement interrompu : {e}"))?;
    if !bytes.windows(4).any(|w| w == b"<gpx") {
        return Err("Openrunner n'a pas renvoyé de GPX".into());
    }
    std::fs::write(dest, &bytes).map_err(|e| format!("{} : {e}", dest.display()))
}

#[cfg(test)]
mod tests {
    use super::route_id;

    #[test]
    fn liens() {
        assert_eq!(route_id("https://www.openrunner.com/route-details/24118757").as_deref(), Some("24118757"));
        assert_eq!(route_id("https://www.openrunner.com/fr/route-details/15424659?ref=partage").as_deref(), Some("15424659"));
        assert_eq!(route_id("  24118757 ").as_deref(), Some("24118757"));
        assert_eq!(route_id("https://www.komoot.com/tour/123456"), None);
        assert_eq!(route_id("bonjour"), None);
    }
}
