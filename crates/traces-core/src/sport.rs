//! Sport d'une trace : traduction du champ `<type>` du GPX en dossier de rangement.

/// Dossiers proposés, dans l'ordre d'affichage. Le dernier sert par défaut.
pub const SPORTS: [&str; 6] = ["Route", "Gravel", "VTT", "Randonnée", "Course à pied", "Vélo"];

/// Sport utilisé quand le GPX ne dit rien.
pub const DEFAULT_SPORT: &str = "Vélo";

/// Traduit le `<type>` d'un GPX (Komoot, Garmin, Openrunner…) en dossier français.
///
/// Exemples : `racebike` → Route, `gravel_cycling` ou `mtb_easy` (Komoot) → Gravel, `mtb` → VTT,
/// `hike` → Randonnée, `jogging` → Course à pied. Inconnu ou absent → Vélo.
pub fn sport_from_type(gpx_type: Option<&str>) -> &'static str {
    let Some(t) = gpx_type.map(str::to_lowercase) else {
        return DEFAULT_SPORT;
    };
    let has = |words: &[&str]| words.iter().any(|w| t.contains(w));
    // Chez Komoot, `mtb_easy` est le sport « Gravel » (le VTT est `mtb`, l’enduro `mtb_advanced`).
    if has(&["gravel", "mtb_easy"]) {
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

/// Sport d'une trace : le `<type>` du GPX, sinon un mot du titre (Openrunner
/// n'écrit pas de `<type>`) : « gravel », « VTT », « rando »…
pub fn sport_for(gpx_type: Option<&str>, name: &str) -> &'static str {
    let from_type = sport_from_type(gpx_type);
    if from_type != DEFAULT_SPORT {
        return from_type;
    }
    let n = name.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| n.contains(w));
    if has(&["gravel"]) {
        "Gravel"
    } else if has(&["vtt", "mtb"]) {
        "VTT"
    } else if has(&["rando", "hike", "hiking", "trek"]) {
        "Randonnée"
    } else {
        DEFAULT_SPORT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sport_par_le_titre() {
        assert_eq!(sport_for(None, "np#614 super chill gravel"), "Gravel");
        assert_eq!(sport_for(None, "Boucle VTT forêt"), "VTT");
        assert_eq!(sport_for(None, "Le_Mythique_SBC_SPIDER_2022_2708"), "Vélo");
        // Le <type> du GPX prime sur le titre.
        assert_eq!(sport_for(Some("racebike"), "Route du gravel"), "Route");
    }

    #[test]
    fn types_courants() {
        assert_eq!(sport_from_type(Some("racebike")), "Route");
        assert_eq!(sport_from_type(Some("cycling")), "Route");
        assert_eq!(sport_from_type(Some("road_biking")), "Route");
        assert_eq!(sport_from_type(Some("touringbicycle")), "Route");
        assert_eq!(sport_from_type(Some("gravel_cycling")), "Gravel");
        assert_eq!(sport_from_type(Some("mtb_easy")), "Gravel");
        assert_eq!(sport_from_type(Some("mtb")), "VTT");
        assert_eq!(sport_from_type(Some("mtb_advanced")), "VTT");
        assert_eq!(sport_from_type(Some("mountain_biking")), "VTT");
        assert_eq!(sport_from_type(Some("hike")), "Randonnée");
        assert_eq!(sport_from_type(Some("jogging")), "Course à pied");
        assert_eq!(sport_from_type(Some("1")), "Vélo");
        assert_eq!(sport_from_type(None), "Vélo");
    }
}
