//! Revêtement le long d'une trace, calculé depuis OpenStreetMap.
//!
//! Comme Pédalons (service osm-route-details), on lit les voies dans les tuiles
//! vectorielles OSM au schéma Shortbread (VersaTiles, gratuites, sans clé) : l'interface
//! télécharge les tuiles qui couvrent la trace et en extrait les voies proches,
//! puis [`match_surface`] associe chaque portion de la trace à la voie la plus
//! proche (moins de 25 m, et dans le sens de la trace aux carrefours).
//! Le résultat est rangé dans l'index par tronçons de km.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::geo::local_xy;
use crate::model::ProfilePoint;

/// Classe de revêtement affichée sur le profil et la carte.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SurfaceClass {
    /// Asphalte, béton.
    Paved,
    /// Pavés.
    Cobbles,
    /// Stabilisé, gravier.
    Gravel,
    /// Chemin de terre, herbe, sable.
    Unpaved,
    /// Voie introuvable ou revêtement non renseigné dans OSM.
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceRun {
    pub from_km: f64,
    pub to_km: f64,
    pub class: SurfaceClass,
}

/// Voie OSM utile au calcul : ses tags (`highway`, `surface`, `tracktype`) et sa
/// géométrie en [lat, lon].
#[derive(Debug, Clone, Deserialize)]
pub struct OsmWay {
    pub tags: HashMap<String, String>,
    pub geometry: Vec<(f64, f64)>,
}

/// Distance maximale entre la trace et la voie retenue.
const MAX_DIST_M: f64 = 25.0;
/// Pas d'échantillonnage de la trace pour l'association (km).
const SAMPLE_KM: f64 = 0.05;
/// Tronçon plus court que ça : absorbé par le précédent (bruit aux carrefours).
const MIN_RUN_KM: f64 = 0.12;

/// Classe d'une voie d'après ses tags OSM (`surface`, sinon `highway` / `tracktype`).
pub fn classify(tags: &HashMap<String, String>) -> SurfaceClass {
    use SurfaceClass::*;
    if let Some(s) = tags.get("surface") {
        let s = s.split(';').next().unwrap_or("").trim();
        match s {
            "asphalt" | "paved" | "concrete" | "concrete:plates" | "concrete:lanes" | "chipseal" | "metal" | "wood"
            | "rubber" | "tartan" => return Paved,
            "paving_stones" | "sett" | "cobblestone" | "unhewn_cobblestone" | "bricks" | "cobblestone:flattened" => {
                return Cobbles
            }
            "compacted" | "fine_gravel" | "gravel" | "pebblestone" | "shells" => return Gravel,
            "unpaved" | "dirt" | "earth" | "ground" | "grass" | "mud" | "sand" | "woodchips" | "rock" | "grass_paver" => {
                return Unpaved
            }
            _ => {}
        }
    }
    match tags.get("highway").map(String::as_str) {
        Some(
            "motorway" | "motorway_link" | "trunk" | "trunk_link" | "primary" | "primary_link" | "secondary"
            | "secondary_link" | "tertiary" | "tertiary_link" | "unclassified" | "residential" | "living_street"
            | "service" | "cycleway" | "road",
        ) => Paved,
        Some("track") => match tags.get("tracktype").map(String::as_str) {
            Some("grade1") => Paved,
            Some("grade2") => Gravel,
            Some(_) => Unpaved,
            None => Unpaved,
        },
        _ => Unknown,
    }
}

/// Segment de voie projeté en mètres autour du départ de la trace.
struct Seg {
    a: (f64, f64),
    b: (f64, f64),
    class: SurfaceClass,
}

/// Associe la trace aux voies OSM et renvoie les tronçons de revêtement.
pub fn match_surface(profile: &[ProfilePoint], ways: &[OsmWay]) -> Vec<SurfaceRun> {
    let Some(first) = profile.first() else { return Vec::new() };
    let total = profile.last().map(|p| p.km).unwrap_or(0.0);
    if total <= 0.0 {
        return Vec::new();
    }
    let (lat0, lon0) = (first.lat, first.lon);
    let xy = |lat: f64, lon: f64| {
        let (x, y) = local_xy(lat0, lon0, lat, lon);
        (x * 1000.0, y * 1000.0)
    };

    // Grille de 100 m pour retrouver vite les segments proches.
    const CELL: f64 = 100.0;
    let cell = |p: (f64, f64)| ((p.0 / CELL).floor() as i64, (p.1 / CELL).floor() as i64);
    let mut segs: Vec<Seg> = Vec::new();
    let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for w in ways {
        let class = classify(&w.tags);
        let pts: Vec<(f64, f64)> = w.geometry.iter().map(|&(la, lo)| xy(la, lo)).collect();
        for pair in pts.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            let i = segs.len();
            segs.push(Seg { a, b, class });
            let (c0, c1) = (cell((a.0.min(b.0), a.1.min(b.1))), cell((a.0.max(b.0), a.1.max(b.1))));
            for cx in c0.0..=c1.0 {
                for cy in c0.1..=c1.1 {
                    grid.entry((cx, cy)).or_default().push(i);
                }
            }
        }
    }

    // Échantillons réguliers le long de la trace (interpolés entre les points du profil).
    let n = ((total / SAMPLE_KM).ceil() as usize).max(1);
    let at = |km: f64| -> (f64, f64) {
        let i = profile.partition_point(|p| p.km < km).clamp(1, profile.len() - 1);
        let (p, q) = (&profile[i - 1], &profile[i]);
        let f = if q.km > p.km { ((km - p.km) / (q.km - p.km)).clamp(0.0, 1.0) } else { 0.0 };
        xy(p.lat + (q.lat - p.lat) * f, p.lon + (q.lon - p.lon) * f)
    };
    let mut classes = Vec::with_capacity(n);
    for k in 0..n {
        let km = (k as f64 + 0.5) * total / n as f64;
        let p = at(km);
        let before = at((km - SAMPLE_KM).max(0.0));
        let after = at((km + SAMPLE_KM).min(total));
        let dir = (after.0 - before.0, after.1 - before.1);
        let c = cell(p);
        let mut best: Option<(f64, SurfaceClass)> = None;
        for cx in c.0 - 1..=c.0 + 1 {
            for cy in c.1 - 1..=c.1 + 1 {
                for &i in grid.get(&(cx, cy)).map(Vec::as_slice).unwrap_or(&[]) {
                    let s = &segs[i];
                    let d = dist_to_seg(p, s.a, s.b);
                    if d > MAX_DIST_M {
                        continue;
                    }
                    // Aux carrefours, préférer la voie qui va dans le sens de la trace.
                    let score = d + if crosses(dir, (s.b.0 - s.a.0, s.b.1 - s.a.1)) { 15.0 } else { 0.0 };
                    if best.map_or(true, |(b, _)| score < b) {
                        best = Some((score, s.class));
                    }
                }
            }
        }
        classes.push(best.map(|b| b.1).unwrap_or(SurfaceClass::Unknown));
    }

    // Tronçons, puis absorption des tronçons trop courts.
    let step = total / n as f64;
    let mut runs: Vec<SurfaceRun> = Vec::new();
    for (k, c) in classes.into_iter().enumerate() {
        let (a, b) = (k as f64 * step, (k + 1) as f64 * step);
        match runs.last_mut() {
            Some(r) if r.class == c => r.to_km = b,
            _ => runs.push(SurfaceRun { from_km: a, to_km: b, class: c }),
        }
    }
    let mut out: Vec<SurfaceRun> = Vec::new();
    for r in runs {
        if let Some(last) = out.last_mut() {
            if last.class == r.class || r.to_km - r.from_km < MIN_RUN_KM {
                last.to_km = r.to_km;
                continue;
            }
            if last.to_km - last.from_km < MIN_RUN_KM {
                // Le précédent était trop court : il prend la classe du suivant.
                last.class = r.class;
                last.to_km = r.to_km;
                continue;
            }
        }
        out.push(r);
    }
    // Fusionne ce qui est devenu contigu et identique.
    let mut merged: Vec<SurfaceRun> = Vec::new();
    for r in out {
        match merged.last_mut() {
            Some(m) if m.class == r.class => m.to_km = r.to_km,
            _ => merged.push(r),
        }
    }
    if let Some(l) = merged.last_mut() {
        l.to_km = total;
    }
    merged
}

/// Part de chaque classe (en km).
pub fn totals(runs: &[SurfaceRun]) -> HashMap<SurfaceClass, f64> {
    let mut m = HashMap::new();
    for r in runs {
        *m.entry(r.class).or_insert(0.0) += r.to_km - r.from_km;
    }
    m
}

fn dist_to_seg(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 { (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
    let (x, y) = (a.0 + t * dx - p.0, a.1 + t * dy - p.1);
    (x * x + y * y).sqrt()
}

/// Vrai si les deux directions font un angle de plus de 40° (sans tenir compte du sens).
fn crosses(u: (f64, f64), v: (f64, f64)) -> bool {
    let (nu, nv) = ((u.0 * u.0 + u.1 * u.1).sqrt(), (v.0 * v.0 + v.1 * v.1).sqrt());
    if nu == 0.0 || nv == 0.0 {
        return false;
    }
    ((u.0 * v.0 + u.1 * v.1) / (nu * nv)).abs() < 40f64.to_radians().cos()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(kv: &[(&str, &str)]) -> HashMap<String, String> {
        kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn pt(km: f64, lat: f64, lon: f64) -> ProfilePoint {
        ProfilePoint { km, lat, lon, ele: 0.0, slope: 0.0, slope_max: 0.0, up: 0.0, down: 0.0, minutes: None }
    }

    #[test]
    fn classes_osm() {
        assert_eq!(classify(&tags(&[("highway", "residential")])), SurfaceClass::Paved);
        assert_eq!(classify(&tags(&[("highway", "residential"), ("surface", "sett")])), SurfaceClass::Cobbles);
        assert_eq!(classify(&tags(&[("highway", "track"), ("tracktype", "grade2")])), SurfaceClass::Gravel);
        assert_eq!(classify(&tags(&[("highway", "track")])), SurfaceClass::Unpaved);
        assert_eq!(classify(&tags(&[("highway", "path"), ("surface", "fine_gravel")])), SurfaceClass::Gravel);
        assert_eq!(classify(&tags(&[("highway", "footway")])), SurfaceClass::Unknown);
    }

    #[test]
    fn route_puis_chemin() {
        // Trace plein est sur ~2 km le long de l'équateur : 1 km de route puis 1 km de chemin.
        let deg_km = 1.0 / 111.195;
        let profile: Vec<ProfilePoint> = (0..=20).map(|i| pt(i as f64 * 0.1, 0.0, i as f64 * 0.1 * deg_km)).collect();
        let road = OsmWay { tags: tags(&[("highway", "tertiary")]), geometry: vec![(0.0001, 0.0), (0.0001, deg_km)] };
        let track = OsmWay {
            tags: tags(&[("highway", "track"), ("tracktype", "grade4")]),
            geometry: vec![(0.0001, deg_km), (0.0001, 2.0 * deg_km)],
        };
        // Une route qui croise la trace à angle droit ne doit pas être retenue.
        let cross = OsmWay {
            tags: tags(&[("highway", "path"), ("surface", "sand")]),
            geometry: vec![(-0.001, 0.5 * deg_km), (0.001, 0.5 * deg_km)],
        };
        let runs = match_surface(&profile, &[road, track, cross]);
        assert_eq!(runs.len(), 2, "{runs:?}");
        assert_eq!(runs[0].class, SurfaceClass::Paved);
        assert_eq!(runs[1].class, SurfaceClass::Unpaved);
        assert!((runs[0].to_km - 1.0).abs() < 0.1, "{runs:?}");
        assert!((runs[1].to_km - 2.0).abs() < 1e-9);
    }

}
