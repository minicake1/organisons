//! POI proposés depuis OpenStreetMap : appel de l'API Overpass (service public,
//! une requête par portion de trace, l'une après l'autre). La préparation de la
//! requête et le tri des résultats sont dans `traces_core::osm`.

use crate::http;

const MAIN: &str = "https://overpass-api.de/api/interpreter";
/// Serveur principal, de nouveau après une pause s'il est saturé (il le dit lui-même :
/// réessayer en espaçant), puis un miroir public.
const OVERPASS: &[(&str, u64)] = &[(MAIN, 0), (MAIN, 8), (MAIN, 20), ("https://overpass.private.coffee/api/interpreter", 0)];
const SERVICE: &str = "OpenStreetMap (Overpass)";

/// Envoie une requête Overpass et renvoie la réponse JSON.
pub fn fetch(query: &str) -> Result<String, String> {
    let mut last = String::new();
    for (url, pause) in OVERPASS {
        std::thread::sleep(std::time::Duration::from_secs(*pause));
        match http::agent().post(url).send_form(&[("data", query)]) {
            Ok(r) => return r.into_string().map_err(|e| format!("{SERVICE} : réponse illisible ({e})")),
            // Saturé : on essaie le serveur suivant.
            Err(ureq::Error::Status(429 | 502 | 503 | 504, _)) => {
                last = format!("{SERVICE} est très demandé en ce moment : réessaie dans une minute (service public et gratuit).")
            }
            Err(ureq::Error::Status(code, r)) => return Err(http::status(SERVICE, code, r)),
            Err(ureq::Error::Transport(t)) => last = http::unreachable(SERVICE, t),
        }
    }
    Err(last)
}
