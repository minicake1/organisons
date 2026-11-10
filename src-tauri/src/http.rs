//! Réglages HTTP communs à tous les services en ligne (Komoot, Openrunner,
//! Hammerhead, intervals.icu).

use std::time::Duration;

/// Client HTTP : délai de 60 s, et Organisons se présente sous son nom.
pub fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("Organisons/", env!("CARGO_PKG_VERSION")))
        .build()
}

/// Message d'un service injoignable (pas de réseau, DNS, délai dépassé…).
pub fn unreachable(service: &str, t: ureq::Transport) -> String {
    format!("{service} est injoignable (connexion internet ?) : {t}")
}

/// Réponse en erreur d'un service, avec le début de son explication.
pub fn status(service: &str, code: u16, r: ureq::Response) -> String {
    let body = r.into_string().unwrap_or_default();
    format!("{service} a répondu {code} {}", body.chars().take(200).collect::<String>()).trim_end().to_string()
}
