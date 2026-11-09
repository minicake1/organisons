//! Petites fonctions géographiques.

const EARTH_RADIUS_KM: f64 = 6371.0;

/// Distance orthodromique (haversine) en km.
pub fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dp = (lat2 - lat1).to_radians();
    let dl = (lon2 - lon1).to_radians();
    let h = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * h.sqrt().asin()
}

/// Projection locale équirectangulaire autour d'un point de référence,
/// en km : x vers l'est, y vers le nord.
pub fn local_xy(lat0: f64, lon0: f64, lat: f64, lon: f64) -> (f64, f64) {
    let k = std::f64::consts::PI / 180.0 * EARTH_RADIUS_KM;
    ((lon - lon0) * k * lat0.to_radians().cos(), (lat - lat0) * k)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paris_lyon() {
        let d = haversine_km(48.8566, 2.3522, 45.764, 4.8357);
        assert!((d - 392.0).abs() < 3.0, "{d}");
    }
}
