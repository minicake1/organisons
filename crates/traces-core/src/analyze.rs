//! Analyse d'un fichier GPX : distance, dénivelé lissé, relief, vent idéal,
//! points d'intérêt et profil ré-échantillonné.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use crate::error::{Error, Result};
use crate::geo::{haversine_km, local_xy};
use crate::model::*;

/// Pas de ré-échantillonnage de l'altitude (km).
const STEP_KM: f64 = 0.05;
/// Demi-largeur de la moyenne glissante, en pas (2 → fenêtre de 250 m).
const SMOOTH_HALF: usize = 2;
/// Seuil d'hystérésis pour le cumul de dénivelé (m).
const HYSTERESIS_M: f64 = 3.0;
/// Demi-largeur pour la pente locale, en pas (2 → 200 m).
const SLOPE_HALF: usize = 2;

struct RawPoint {
    lat: f64,
    lon: f64,
    ele: Option<f64>,
    /// secondes Unix
    time: Option<f64>,
}

pub fn analyze_file(path: &Path) -> Result<TraceAnalysis> {
    let file = File::open(path).map_err(|source| Error::Io { path: path.to_owned(), source })?;
    let gpx = gpx::read(BufReader::new(file)).map_err(|e| Error::Gpx {
        path: path.to_owned(),
        message: e.to_string(),
    })?;
    let fallback = path
        .file_stem()
        .map(|s| s.to_string_lossy().replace(['_', '-'], " "))
        .unwrap_or_else(|| "Sans nom".into());
    analyze_gpx(&gpx, &fallback).ok_or_else(|| Error::Empty(path.to_owned()))
}

/// Analyse un GPX déjà lu. `None` s'il n'y a aucun point.
pub fn analyze_gpx(gpx: &gpx::Gpx, fallback_name: &str) -> Option<TraceAnalysis> {
    fn to_raw(w: &gpx::Waypoint) -> RawPoint {
        let p = w.point();
        RawPoint {
            lat: p.y(),
            lon: p.x(),
            ele: w.elevation,
            time: w.time.map(|t| {
                let odt: time::OffsetDateTime = t.into();
                odt.unix_timestamp_nanos() as f64 / 1e9
            }),
        }
    }
    let mut raw: Vec<RawPoint> = gpx
        .tracks
        .iter()
        .flat_map(|t| t.segments.iter())
        .flat_map(|s| s.points.iter())
        .map(to_raw)
        .collect();
    if raw.is_empty() {
        raw = gpx.routes.iter().flat_map(|r| r.points.iter()).map(to_raw).collect();
    }
    if raw.is_empty() {
        return None;
    }

    // Distance cumulée.
    let mut cum = Vec::with_capacity(raw.len());
    cum.push(0.0);
    for w in raw.windows(2) {
        let d = haversine_km(w[0].lat, w[0].lon, w[1].lat, w[1].lon);
        cum.push(cum.last().unwrap() + d);
    }
    let total = *cum.last().unwrap();

    // Altitude ré-échantillonnée tous les 50 m puis lissée.
    let has_ele = raw.iter().any(|p| p.ele.is_some());
    let n50 = ((total / STEP_KM).floor() as usize + 1).max(2);
    let eles: Vec<f64> = fill_missing(raw.iter().map(|p| p.ele).collect());
    let e50: Vec<f64> = (0..n50)
        .map(|k| interp(&cum, &eles, (k as f64 * STEP_KM).min(total)))
        .collect();
    let smooth: Vec<f64> = (0..n50)
        .map(|i| {
            let a = i.saturating_sub(SMOOTH_HALF);
            let b = (i + SMOOTH_HALF).min(n50 - 1);
            e50[a..=b].iter().sum::<f64>() / (b - a + 1) as f64
        })
        .collect();
    let slope50: Vec<f64> = (0..n50)
        .map(|i| {
            let a = i.saturating_sub(SLOPE_HALF);
            let b = (i + SLOPE_HALF).min(n50 - 1);
            if b > a {
                (smooth[b] - smooth[a]) / ((b - a) as f64 * STEP_KM * 1000.0) * 100.0
            } else {
                0.0
            }
        })
        .collect();

    // D+ / D- avec hystérésis.
    let (mut up, mut down) = (0.0, 0.0);
    let mut reference = smooth[0];
    let mut up50 = vec![0.0; n50];
    let mut down50 = vec![0.0; n50];
    for i in 0..n50 {
        let d = smooth[i] - reference;
        if d >= HYSTERESIS_M {
            up += d;
            reference = smooth[i];
        } else if d <= -HYSTERESIS_M {
            down -= d;
            reference = smooth[i];
        }
        up50[i] = up;
        down50[i] = down;
    }
    let (ele_min, ele_max) = smooth
        .iter()
        .fold((f64::MAX, f64::MIN), |(lo, hi), &e| (lo.min(e), hi.max(e)));

    // Profil de sortie : 4 points par km, entre 200 et 2000 points.
    let n_out = ((total * 4.0) as usize).clamp(200, 2000);
    let lats: Vec<f64> = raw.iter().map(|p| p.lat).collect();
    let lons: Vec<f64> = raw.iter().map(|p| p.lon).collect();
    let has_time = raw.iter().all(|p| p.time.is_some());
    let times: Vec<f64> = if has_time { raw.iter().map(|p| p.time.unwrap()).collect() } else { vec![] };
    let t0 = times.first().copied();
    let mut profile = Vec::with_capacity(n_out + 1);
    for k in 0..=n_out {
        let km = total * k as f64 / n_out as f64;
        let i50 = ((km / STEP_KM).round() as usize).min(n50 - 1);
        let a = ((total * (k as f64 - 0.5).max(0.0) / n_out as f64) / STEP_KM).round() as usize;
        let b = (((total * (k as f64 + 0.5).min(n_out as f64) / n_out as f64) / STEP_KM).round() as usize).min(n50 - 1);
        let slope_max = slope50[a.min(b)..=b]
            .iter()
            .copied()
            .fold(0.0_f64, |m, s| if s.abs() > m.abs() { s } else { m });
        profile.push(ProfilePoint {
            km: round(km, 3),
            lat: round(interp(&cum, &lats, km), 6),
            lon: round(interp(&cum, &lons, km), 6),
            ele: round(smooth[i50], 1),
            slope: round(slope50[i50], 1),
            slope_max: round(slope_max, 1),
            up: up50[i50].round(),
            down: down50[i50].round(),
            minutes: t0.map(|t0| ((interp(&cum, &times, km) - t0) / 60.0).round()),
        });
    }

    // Emprise.
    let mut bbox = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
    for p in &raw {
        bbox[0] = bbox[0].min(p.lat);
        bbox[1] = bbox[1].min(p.lon);
        bbox[2] = bbox[2].max(p.lat);
        bbox[3] = bbox[3].max(p.lon);
    }

    let raw_name = gpx
        .tracks
        .iter()
        .find_map(|t| t.name.clone())
        .or_else(|| gpx.routes.iter().find_map(|r| r.name.clone()))
        .or_else(|| gpx.metadata.as_ref().and_then(|m| m.name.clone()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_name.to_string());
    // Nom affiché = nom du fichier rangé : sans « _ », date ni identifiant (voir `naming`).
    let name = crate::naming::clean_name(&raw_name);
    let title_date = crate::naming::date_in_name(&raw_name).and_then(|d| d.timestamp());
    let route_id = crate::naming::route_id(&raw_name);

    let pois = gpx
        .waypoints
        .iter()
        .map(|w| {
            let p = w.point();
            let (lat, lon) = (p.y(), p.x());
            let nearest = nearest_index(&raw, lat, lon);
            let name = w.name.clone().unwrap_or_default().trim().to_string();
            Poi {
                kind: classify_poi(w.symbol.as_deref(), &name),
                name,
                km: round(cum[nearest], 2),
                lat,
                lon,
                symbol: w.symbol.clone(),
            }
        })
        .collect::<Vec<_>>();
    let mut pois = pois;
    pois.sort_by(|a, b| a.km.total_cmp(&b.km));

    let gain = if has_ele { up.round() } else { 0.0 };
    Some(TraceAnalysis {
        name,
        distance_km: round(total, 3),
        elevation_gain: gain,
        elevation_loss: if has_ele { down.round() } else { 0.0 },
        ele_min: if has_ele { ele_min.round() } else { 0.0 },
        ele_max: if has_ele { ele_max.round() } else { 0.0 },
        hilliness: Hilliness::from_ratio(if total > 0.0 { gain / total } else { 0.0 }),
        wind: ideal_wind(&raw),
        start_lat: raw[0].lat,
        start_lon: raw[0].lon,
        bbox,
        point_count: raw.len(),
        has_time,
        creator: gpx.creator.clone(),
        sport_type: gpx
            .tracks
            .iter()
            .find_map(|t| t.type_.clone())
            .or_else(|| gpx.routes.iter().find_map(|r| r.type_.clone()))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        // La date du titre prime : l’heure des points d’un export Openrunner est celle de l’export.
        date: title_date.or_else(|| {
            gpx
            .metadata
            .as_ref()
            .and_then(|m| m.time)
            .map(|t| time::OffsetDateTime::from(t).unix_timestamp())
                .or_else(|| raw.iter().find_map(|p| p.time).map(|t| t as i64))
        }),
        route_id,
        profile,
        pois,
    })
}

/// Direction de vent idéale, même principe que biketeam / gpx2web :
/// moyenne des directions entre le départ et chaque point, puis la
/// direction cardinale la plus proche. Une trace qui part vers le nord
/// convient à un vent du nord : aller face au vent, retour vent dans le dos.
fn ideal_wind(raw: &[RawPoint]) -> WindDirection {
    let (lat0, lon0) = (raw[0].lat, raw[0].lon);
    let (mut sx, mut sy) = (0.0, 0.0);
    for p in raw {
        let (x, y) = local_xy(lat0, lon0, p.lat, p.lon);
        let n = (x * x + y * y).sqrt();
        if n > 1e-9 {
            sx += x / n;
            sy += y / n;
        }
    }
    WindDirection::ALL
        .into_iter()
        .max_by(|a, b| {
            let da = a.angle().to_radians();
            let db = b.angle().to_radians();
            (da.sin() * sx + da.cos() * sy).total_cmp(&(db.sin() * sx + db.cos() * sy))
        })
        .unwrap_or(WindDirection::N)
}

/// Catégorie d'un waypoint : codes Openrunner, symboles Garmin courants,
/// puis le nom en dernier recours.
pub fn classify_poi(symbol: Option<&str>, name: &str) -> PoiKind {
    let n = name.to_lowercase();
    if let Some(sym) = symbol.map(|s| s.trim().to_lowercase()) {
        match sym.as_str() {
            "1" => return PoiKind::Control,
            "15" | "16" => return PoiKind::Warning,
            "104" | "drinking water" => return PoiKind::Water,
            "50" | "shopping center" | "restaurant" | "convenience store" | "food" => return PoiKind::Shop,
            "60" | "scenic area" | "museum" | "church" | "summit" => return PoiKind::Sight,
            "danger area" | "skull and crossbones" => return PoiKind::Warning,
            _ => {}
        }
    }
    let starts_cp = n.starts_with("cp ") || n.starts_with("cp:") || n.starts_with("cp-") || n.starts_with("cp1");
    if starts_cp || n.contains("contrôle") || n.contains("controle") {
        PoiKind::Control
    } else if n.contains("eau") || n.contains("fontaine") || n.contains("water") {
        PoiKind::Water
    } else if n.contains("boulangerie") || n.contains("commerce") || n.contains("café") || n.contains("bar ") {
        PoiKind::Shop
    } else if n.contains("attention") || n.contains("danger") || n.contains("risque") || n.contains('%') {
        PoiKind::Warning
    } else {
        PoiKind::Other
    }
}

fn nearest_index(raw: &[RawPoint], lat: f64, lon: f64) -> usize {
    let c = lat.to_radians().cos();
    let mut best = (0, f64::MAX);
    for (i, p) in raw.iter().enumerate() {
        let d = (p.lat - lat).powi(2) + ((p.lon - lon) * c).powi(2);
        if d < best.1 {
            best = (i, d);
        }
    }
    best.0
}

/// Valeur interpolée à la distance `km` (cum croissant).
fn interp(cum: &[f64], values: &[f64], km: f64) -> f64 {
    if values.len() == 1 {
        return values[0];
    }
    let j = match cum.partition_point(|&c| c <= km) {
        0 => 0,
        i => (i - 1).min(cum.len() - 2),
    };
    let span = cum[j + 1] - cum[j];
    let f = if span > 0.0 { ((km - cum[j]) / span).clamp(0.0, 1.0) } else { 0.0 };
    values[j] + (values[j + 1] - values[j]) * f
}

/// Remplace les altitudes manquantes par la dernière connue (ou la suivante).
fn fill_missing(v: Vec<Option<f64>>) -> Vec<f64> {
    let first = v.iter().flatten().next().copied().unwrap_or(0.0);
    let mut last = first;
    v.into_iter()
        .map(|e| {
            if let Some(e) = e {
                last = e;
            }
            last
        })
        .collect()
}

fn round(x: f64, digits: i32) -> f64 {
    let m = 10f64.powi(digits);
    (x * m).round() / m
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpx_from(points: &[(f64, f64, f64)]) -> gpx::Gpx {
        let mut seg = gpx::TrackSegment::new();
        for &(lat, lon, ele) in points {
            let mut w = gpx::Waypoint::new(geo_types::Point::new(lon, lat));
            w.elevation = Some(ele);
            seg.points.push(w);
        }
        let mut trk = gpx::Track::new();
        trk.segments.push(seg);
        let mut g = gpx::Gpx::default();
        g.version = gpx::GpxVersion::Gpx11;
        g.tracks.push(trk);
        g
    }

    #[test]
    fn route_vers_le_nord_donne_vent_du_nord() {
        // Aller-retour plein nord.
        let mut pts: Vec<(f64, f64, f64)> = (0..50).map(|i| (45.0 + i as f64 * 0.002, 5.0, 200.0)).collect();
        pts.extend((0..50).rev().map(|i| (45.0 + i as f64 * 0.002, 5.001, 200.0)));
        let a = analyze_gpx(&gpx_from(&pts), "test").unwrap();
        assert_eq!(a.wind, WindDirection::N);
        assert_eq!(a.hilliness, Hilliness::Flat);
        assert_eq!(a.elevation_gain, 0.0);
    }

    #[test]
    fn montee_reguliere() {
        // 10 km plein est, +500 m réguliers : 50 m/km → montagneux, ~5 %.
        let pts: Vec<(f64, f64, f64)> =
            (0..=200).map(|i| (45.0, 5.0 + i as f64 * 0.000_635, i as f64 * 2.5)).collect();
        let a = analyze_gpx(&gpx_from(&pts), "test").unwrap();
        assert!((a.distance_km - 10.0).abs() < 0.2, "{}", a.distance_km);
        assert!((a.elevation_gain - 500.0).abs() < 25.0, "{}", a.elevation_gain);
        assert_eq!(a.hilliness, Hilliness::Mountainous);
        assert_eq!(a.wind, WindDirection::E);
        let mid = &a.profile[a.profile.len() / 2];
        assert!((mid.slope - 5.0).abs() < 0.5, "{}", mid.slope);
    }

    #[test]
    fn categories_poi() {
        assert_eq!(classify_poi(Some("1"), "CP 4 - Pointe du Roc"), PoiKind::Control);
        assert_eq!(classify_poi(Some("104"), "Eau cimetière"), PoiKind::Water);
        assert_eq!(classify_poi(None, "Fontaine du bourg"), PoiKind::Water);
        assert_eq!(classify_poi(Some("Flag"), "CP 2 Vallet"), PoiKind::Control);
        assert_eq!(classify_poi(None, "Vue"), PoiKind::Other);
    }
}
