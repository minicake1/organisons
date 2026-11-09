//! Sport d'une trace : traduction du champ `<type>` du GPX en dossier de rangement.

/// Dossiers proposés, dans l'ordre d'affichage. Le dernier sert par défaut.
pub const SPORTS: [&str; 6] = ["Route", "Gravel", "VTT", "Randonnée", "Course à pied", "Vélo"];

/// Sport utilisé quand le GPX ne dit rien.
pub const DEFAULT_SPORT: &str = "Vélo";

/// Traduit le `<type>` d'un GPX (Komoot, Garmin, Openrunner…) en dossier français.
///
/// Exemples : `racebike` → Route, `gravel_cycling` → Gravel, `mtb_easy` → VTT,
/// `hike` → Randonnée, `jogging` → Course à pied. Inconnu ou absent → Vélo.
pub fn sport_from_type(gpx_type: Option<&str>) -> &'static str {
    let Some(t) = gpx_type.map(str::to_lowercase) else {
        return DEFAULT_SPORT;
    };
    let has = |words: &[&str]| words.iter().any(|w| t.contains(w));
    if has(&["gravel"]) {
        "Gravel"
    } else if has(&["mtb", "mountain", "vtt", "enduro", "downhill"]) {
        "VTT"
    } else if has(&["hik", "walk", "rando", "trek"]) {
        "Randonnée"
    } else if has(&["run", "jog", "course"]) {
        "Course à pied"
    } else if has(&["road", "racebike", "route", "touringbicycle", "cycl", "bik", "ride", "velo", "vélo"]) {
        "Route"
    } else {
        DEFAULT_SPORT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_courants() {
        assert_eq!(sport_from_type(Some("racebike")), "Route");
        assert_eq!(sport_from_type(Some("cycling")), "Route");
        assert_eq!(sport_from_type(Some("road_biking")), "Route");
        assert_eq!(sport_from_type(Some("touringbicycle")), "Route");
        assert_eq!(sport_from_type(Some("gravel_cycling")), "Gravel");
        assert_eq!(sport_from_type(Some("mtb_easy")), "VTT");
        assert_eq!(sport_from_type(Some("mountain_biking")), "VTT");
        assert_eq!(sport_from_type(Some("hike")), "Randonnée");
        assert_eq!(sport_from_type(Some("jogging")), "Course à pied");
        assert_eq!(sport_from_type(Some("1")), "Vélo");
        assert_eq!(sport_from_type(None), "Vélo");
    }
}
