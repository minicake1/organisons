//! Points d'intérêt proposés depuis OpenStreetMap le long d'une trace.
//!
//! L'appli interroge l'API Overpass (service public, à utiliser avec modération)
//! avec une seule requête par portion de trace : les objets OSM des étiquettes
//! connues (`FEATURES`) à moins de la plus grande distance demandée. Le cœur
//! prépare la requête ([`queries`]) et trie la réponse ([`candidates`]) : distance
//! réelle à la trace, règle de la catégorie (sur la trace ou à N mètres au plus),
//! POI déjà présents écartés.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::geo::local_xy;
use crate::model::{Poi, PoiKind, ProfilePoint};

/// « Sur la trace » : à cette distance au plus (m), le point se voit sans détour.
pub const ON_TRACE_M: u32 = 30;

/// Règle d'une catégorie : cherchée ou non, et distance à la trace au plus (m).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsmRule {
    pub enabled: bool,
    pub max_m: u32,
}

/// Densité des propositions, commune à toutes les catégories mais comptée pour
/// chacune à part : au plus `count` points par tranche de `every_km` km.
/// Appliquée par l'interface sur les résultats, sans nouvelle recherche.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsmDensity {
    pub count: u32,
    pub every_km: f64,
}

/// Règles par catégorie (clé : `PoiKind::as_str`).
pub type OsmRules = BTreeMap<String, OsmRule>;

/// Catégories proposées depuis OSM, avec leur règle par défaut : eau et
/// services (toilettes, réparation…) sur la trace, commerces et hébergements à
/// 500 m, curiosités à 200 m (non cherchées par défaut).
pub fn default_rules() -> OsmRules {
    [
        (PoiKind::Water, true, ON_TRACE_M),
        (PoiKind::Service, true, ON_TRACE_M),
        (PoiKind::Shop, true, 500),
        (PoiKind::Lodging, true, 500),
        (PoiKind::Sight, false, 200),
    ]
    .into_iter()
    .map(|(k, enabled, max_m)| (k.as_str().to_string(), OsmRule { enabled, max_m }))
    .collect()
}

/// Règles enregistrées complétées par les valeurs par défaut (catégorie ajoutée
/// dans une version plus récente, réglage absent).
pub fn with_defaults(saved: Option<&str>) -> OsmRules {
    let mut rules = default_rules();
    if let Some(saved) = saved.and_then(|s| serde_json::from_str::<OsmRules>(s).ok()) {
        for (k, r) in saved {
            if rules.contains_key(&k) {
                rules.insert(k, r);
            }
        }
    }
    rules
}

/// Une étiquette OSM reconnue : clé, valeur, condition éventuelle, catégorie et libellé.
struct Feature {
    key: &'static str,
    value: &'static str,
    /// Étiquette supplémentaire exigée (clé, valeur).
    also: Option<(&'static str, &'static str)>,
    kind: PoiKind,
    label: &'static str,
}

const fn f(key: &'static str, value: &'static str, kind: PoiKind, label: &'static str) -> Feature {
    Feature { key, value, also: None, kind, label }
}

const FEATURES: &[Feature] = &[
    // Eau
    f("amenity", "drinking_water", PoiKind::Water, "Eau potable"),
    f("amenity", "water_point", PoiKind::Water, "Point d'eau"),
    f("man_made", "water_tap", PoiKind::Water, "Robinet"),
    Feature { key: "amenity", value: "fountain", also: Some(("drinking_water", "yes")), kind: PoiKind::Water, label: "Fontaine (eau potable)" },
    Feature { key: "natural", value: "spring", also: Some(("drinking_water", "yes")), kind: PoiKind::Water, label: "Source (eau potable)" },
    // Services
    f("amenity", "toilets", PoiKind::Service, "Toilettes"),
    f("amenity", "bicycle_repair_station", PoiKind::Service, "Réparation vélo"),
    f("shop", "bicycle", PoiKind::Service, "Magasin de vélos"),
    f("amenity", "pharmacy", PoiKind::Service, "Pharmacie"),
    // Hébergement
    f("tourism", "hotel", PoiKind::Lodging, "Hôtel"),
    f("tourism", "motel", PoiKind::Lodging, "Hôtel"),
    f("tourism", "guest_house", PoiKind::Lodging, "Chambre d'hôtes"),
    f("tourism", "hostel", PoiKind::Lodging, "Auberge de jeunesse"),
    f("tourism", "chalet", PoiKind::Lodging, "Gîte"),
    f("tourism", "camp_site", PoiKind::Lodging, "Camping"),
    f("tourism", "alpine_hut", PoiKind::Lodging, "Refuge"),
    f("tourism", "wilderness_hut", PoiKind::Lodging, "Abri"),
    // Commerces
    f("shop", "bakery", PoiKind::Shop, "Boulangerie"),
    f("shop", "pastry", PoiKind::Shop, "Pâtisserie"),
    f("shop", "convenience", PoiKind::Shop, "Épicerie"),
    f("shop", "supermarket", PoiKind::Shop, "Supermarché"),
    f("amenity", "cafe", PoiKind::Shop, "Café"),
    f("amenity", "restaurant", PoiKind::Shop, "Restaurant"),
    f("amenity", "fast_food", PoiKind::Shop, "Restauration rapide"),
    f("amenity", "bar", PoiKind::Shop, "Bar"),
    f("amenity", "pub", PoiKind::Shop, "Bar"),
    f("amenity", "fuel", PoiKind::Shop, "Station-service"),
    // Curiosités
    f("tourism", "viewpoint", PoiKind::Sight, "Point de vue"),
    f("tourism", "attraction", PoiKind::Sight, "Curiosité"),
    f("historic", "castle", PoiKind::Sight, "Château"),
    f("historic", "monument", PoiKind::Sight, "Monument"),
    f("natural", "peak", PoiKind::Sight, "Sommet"),
];

/// Taille d'une portion de trace (diagonale de son rectangle, km) : une requête par portion.
const PORTION_KM: f64 = 40.0;

/// Requêtes Overpass pour la trace : la trace découpée en portions d'environ
/// 40 km, chacune dans un rectangle élargi de la plus grande distance demandée,
/// avec une recherche par clé (`amenity`, `shop`…) sur les valeurs des catégories
/// cherchées. Le tri précis (distance réelle à la trace) est fait par [`candidates`].
/// Vide si aucune catégorie n'est cherchée.
///
/// (La recherche Overpass « autour d'une ligne », `around` avec plusieurs points,
/// ne renvoyait rien sur le serveur public en novembre 2026 : d'où les rectangles.)
pub fn queries(profile: &[ProfilePoint], rules: &OsmRules) -> Vec<String> {
    let kinds: HashSet<PoiKind> = rules.iter().filter(|(_, r)| r.enabled).map(|(k, _)| PoiKind::parse(k)).collect();
    let radius = rules.values().filter(|r| r.enabled).map(|r| r.max_m).max().unwrap_or(0) as f64;
    if kinds.is_empty() || profile.len() < 2 {
        return Vec::new();
    }
    // Valeurs cherchées, par clé, dans l'ordre du tableau.
    let mut by_key: Vec<(&str, Vec<&str>)> = Vec::new();
    for ft in FEATURES.iter().filter(|ft| kinds.contains(&ft.kind)) {
        match by_key.iter_mut().find(|(k, _)| *k == ft.key) {
            Some((_, values)) if !values.contains(&ft.value) => values.push(ft.value),
            Some(_) => {}
            None => by_key.push((ft.key, vec![ft.value])),
        }
    }
    let filters: String = by_key.iter().map(|(k, values)| format!("nwr[{k}~\"^({})$\"];", values.join("|"))).collect();

    // Portions : rectangles des points successifs, jusqu'à environ 40 km de diagonale.
    let mut out = Vec::new();
    let mut i = 0;
    while i < profile.len() {
        let (mut s, mut w, mut n, mut e) = (profile[i].lat, profile[i].lon, profile[i].lat, profile[i].lon);
        let mut j = i;
        while j + 1 < profile.len() {
            let p = &profile[j + 1];
            let (s2, w2, n2, e2) = (s.min(p.lat), w.min(p.lon), n.max(p.lat), e.max(p.lon));
            if crate::geo::haversine_km(s2, w2, n2, e2) > PORTION_KM && j > i {
                break;
            }
            (s, w, n, e) = (s2, w2, n2, e2);
            j += 1;
        }
        // Élargi de la distance demandée (degrés), arrondi vers l'extérieur.
        let dlat = radius / 111_320.0;
        let dlon = radius / (111_320.0 * ((s + n) / 2.0).to_radians().cos().max(0.1));
        out.push(format!(
            "[out:json][timeout:90][bbox:{:.5},{:.5},{:.5},{:.5}];({filters});out center tags;",
            s - dlat,
            w - dlon,
            n + dlat,
            e + dlon
        ));
        // La portion suivante repart du dernier point : aucun tronçon oublié.
        if j + 1 >= profile.len() {
            break;
        }
        i = j;
    }
    out
}

/// Distance d'un point à un segment (km) et position sur le segment (0 à 1).
fn seg_dist(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> (f64, f64) {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 { (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
    let (x, y) = (a.0 + t * dx - p.0, a.1 + t * dy - p.1);
    ((x * x + y * y).sqrt(), t)
}

/// Point d'intérêt proposé.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsmCandidate {
    /// Identifiant OSM (« node/123 », « way/45 »).
    pub id: String,
    /// Nom OSM, sinon le libellé (« Eau potable »).
    pub name: String,
    /// Ce que c'est (« Boulangerie »).
    pub what: String,
    pub kind: PoiKind,
    pub lat: f64,
    pub lon: f64,
    /// Km du point de la trace le plus proche.
    pub km: f64,
    /// Distance à la trace (m) ; le détour aller-retour est le double.
    pub distance_m: f64,
}

#[derive(Deserialize)]
struct Response {
    elements: Vec<Element>,
    /// Erreur signalée avec une réponse 200 (délai ou mémoire dépassés).
    remark: Option<String>,
}

#[derive(Deserialize)]
struct Element {
    #[serde(rename = "type")]
    kind: String,
    id: i64,
    lat: Option<f64>,
    lon: Option<f64>,
    center: Option<Center>,
    #[serde(default)]
    tags: HashMap<String, String>,
}

#[derive(Deserialize)]
struct Center {
    lat: f64,
    lon: f64,
}

/// Distance à la trace (m) et km le plus proche.
fn nearest(profile: &[ProfilePoint], xy: &[(f64, f64)], lat0: f64, lon0: f64, lat: f64, lon: f64) -> (f64, f64) {
    let p = local_xy(lat0, lon0, lat, lon);
    let mut best = (f64::INFINITY, 0.0);
    for i in 0..xy.len().saturating_sub(1) {
        let (d, t) = seg_dist(p, xy[i], xy[i + 1]);
        if d < best.0 {
            best = (d, profile[i].km + t * (profile[i + 1].km - profile[i].km));
        }
    }
    (best.0 * 1000.0, best.1)
}

/// Candidats tirés des réponses Overpass (JSON) : catégorie reconnue et
/// cherchée, à la distance permise par sa règle, sans POI de la trace à moins
/// de 50 m ; un objet une seule fois ; triés par km.
pub fn candidates(responses: &[String], profile: &[ProfilePoint], rules: &OsmRules, existing: &[Poi]) -> Result<Vec<OsmCandidate>, String> {
    if profile.len() < 2 {
        return Ok(Vec::new());
    }
    let (lat0, lon0) = (profile[0].lat, profile[0].lon);
    let xy: Vec<(f64, f64)> = profile.iter().map(|p| local_xy(lat0, lon0, p.lat, p.lon)).collect();
    let near_existing = |lat: f64, lon: f64| {
        existing.iter().any(|e| crate::geo::haversine_km(lat, lon, e.lat, e.lon) * 1000.0 < 50.0)
    };
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for body in responses {
        let r: Response = serde_json::from_str(body).map_err(|e| format!("réponse d'OpenStreetMap illisible ({e})"))?;
        if let Some(remark) = r.remark.filter(|m| m.contains("error")) {
            return Err(format!("OpenStreetMap (Overpass) n'a pas pu terminer la recherche ({remark}) : réessaie dans un moment."));
        }
        for el in r.elements {
            let id = format!("{}/{}", el.kind, el.id);
            if !seen.insert(id.clone()) {
                continue;
            }
            let Some((lat, lon)) = el.lat.zip(el.lon).or(el.center.map(|c| (c.lat, c.lon))) else { continue };
            // Première étiquette reconnue dont la catégorie est cherchée (un hôtel-restaurant
            // reste proposé comme restaurant si les hébergements ne sont pas cherchés).
            let Some((ft, rule)) = FEATURES
                .iter()
                .filter(|ft| {
                    el.tags.get(ft.key).map(String::as_str) == Some(ft.value)
                        && ft.also.map_or(true, |(k, v)| el.tags.get(k).map(String::as_str) == Some(v))
                })
                .find_map(|ft| rules.get(ft.kind.as_str()).filter(|r| r.enabled).map(|r| (ft, r)))
            else {
                continue;
            };
            let (distance_m, km) = nearest(profile, &xy, lat0, lon0, lat, lon);
            if distance_m > rule.max_m as f64 || near_existing(lat, lon) {
                continue;
            }
            let name = el.tags.get("name").map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).unwrap_or_else(|| ft.label.to_string());
            out.push(OsmCandidate {
                id,
                name,
                what: ft.label.to_string(),
                kind: ft.kind,
                lat,
                lon,
                km: (km * 100.0).round() / 100.0,
                distance_m: distance_m.round(),
            });
        }
    }
    out.sort_by(|a, b| a.km.total_cmp(&b.km));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line() -> Vec<ProfilePoint> {
        // 10 km plein est sur l'équateur de la Manche (lat 49), un point tous les 100 m.
        (0..=100)
            .map(|i| ProfilePoint { km: i as f64 / 10.0, lat: 49.0, lon: -1.0 + i as f64 * 0.001369, ele: 0.0, slope: 0.0, slope_max: 0.0, up: 0.0, down: 0.0, minutes: None })
            .collect()
    }

    #[test]
    fn requete_simplifiee() {
        let q = queries(&line(), &default_rules());
        assert_eq!(q.len(), 1, "10 km : une seule portion");
        assert!(q[0].contains("[bbox:48.99551,"), "élargi de 500 m : {}", q[0]);
        assert!(q[0].contains("nwr[amenity~\"^(drinking_water|water_point|fountain|toilets"), "{}", q[0]);
        assert!(q[0].contains("bakery") && !q[0].contains("viewpoint"));
        // 100 km : plusieurs portions.
        let long: Vec<ProfilePoint> = (0..=1000)
            .map(|i| ProfilePoint { km: i as f64 / 10.0, lat: 49.0, lon: -1.0 + i as f64 * 0.001369, ele: 0.0, slope: 0.0, slope_max: 0.0, up: 0.0, down: 0.0, minutes: None })
            .collect();
        assert_eq!(queries(&long, &default_rules()).len(), 3);
        let none: OsmRules = default_rules().into_iter().map(|(k, r)| (k, OsmRule { enabled: false, ..r })).collect();
        assert!(queries(&line(), &none).is_empty());
    }

    #[test]
    fn candidats_selon_les_regles() {
        let p = line();
        // Lat 49 : 0,0001° de latitude ≈ 11 m.
        let body = r#"{"elements":[
            {"type":"node","id":1,"lat":49.0001,"lon":-0.995,"tags":{"amenity":"drinking_water"}},
            {"type":"node","id":2,"lat":49.002,"lon":-0.99,"tags":{"amenity":"drinking_water"}},
            {"type":"way","id":3,"center":{"lat":49.003,"lon":-0.98},"tags":{"shop":"bakery","name":"Au bon pain"}},
            {"type":"node","id":4,"lat":49.0001,"lon":-0.97,"tags":{"amenity":"fountain"}},
            {"type":"node","id":5,"lat":49.0001,"lon":-0.96,"tags":{"amenity":"fountain","drinking_water":"yes"}},
            {"type":"node","id":6,"lat":49.0001,"lon":-0.95,"tags":{"tourism":"viewpoint"}},
            {"type":"node","id":1,"lat":49.0001,"lon":-0.995,"tags":{"amenity":"drinking_water"}}
        ]}"#;
        let existing = vec![Poi { name: "Fontaine".into(), kind: PoiKind::Water, km: 0.0, lat: 49.0, lon: -0.96, symbol: None, kind_user: false }];
        let c = candidates(&[body.to_string()], &p, &default_rules(), &existing).unwrap();
        let ids: Vec<&str> = c.iter().map(|c| c.id.as_str()).collect();
        // 1 : eau sur la trace ; 2 : eau à 220 m (règle : sur la trace) écartée ; 3 : boulangerie à 330 m gardée ;
        // 4 : fontaine sans eau potable écartée ; 5 : déjà un POI à moins de 50 m ; 6 : curiosités non cherchées ; doublon ignoré.
        assert_eq!(ids, vec!["node/1", "way/3"]);
        assert_eq!(c[0].what, "Eau potable");
        assert_eq!(c[0].name, "Eau potable");
        assert!(c[0].distance_m <= 12.0);
        assert_eq!((c[1].name.as_str(), c[1].kind), ("Au bon pain", PoiKind::Shop));
        assert!((c[1].distance_m - 333.0).abs() < 5.0, "{}", c[1].distance_m);
        assert!(c[0].km < c[1].km);
    }

    #[test]
    fn regles_completees() {
        let r = with_defaults(Some(r#"{"water":{"enabled":false,"maxM":100},"inconnue":{"enabled":true,"maxM":1}}"#));
        assert_eq!(r["water"], OsmRule { enabled: false, max_m: 100 });
        assert!(!r.contains_key("inconnue"));
        assert_eq!(r["shop"].max_m, 500);
    }
}
