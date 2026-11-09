//! Noms de fichier propres pour le rangement : les exports (Openrunner surtout)
//! donnent des noms comme `Le_Mythique_SBC_SPIDER_2022_2708-15424659`.
//!
//! - [`clean_name`] : `_` remplacés par des espaces, identifiant Openrunner final
//!   (`-15424659`) et date retirés → `Le Mythique SBC SPIDER` ;
//! - [`date_in_name`] : la date du titre (27/08/2022), qui sert à `{annee}` et
//!   `{mois}` : l'heure des points d'un export Openrunner est celle de l'export.

/// Date trouvée dans un titre : année, et mois / jour s'ils y sont.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NameDate {
    pub year: i32,
    pub month: Option<u8>,
    pub day: Option<u8>,
}

impl NameDate {
    /// Midi UTC du jour (1er janvier / 1er du mois si incomplet), en secondes Unix.
    pub fn timestamp(&self) -> Option<i64> {
        let month = time::Month::try_from(self.month.unwrap_or(1)).ok()?;
        let d = time::Date::from_calendar_date(self.year, month, self.day.unwrap_or(1)).ok()?;
        Some(d.with_hms(12, 0, 0).ok()?.assume_utc().unix_timestamp())
    }
}

fn is_year(s: &str) -> Option<i32> {
    let y: i32 = s.parse().ok()?;
    (s.len() == 4 && (1990..=2100).contains(&y)).then_some(y)
}

fn day_month(d: &str, m: &str) -> Option<(u8, u8)> {
    let (d, m): (u8, u8) = (d.parse().ok()?, m.parse().ok()?);
    ((1..=31).contains(&d) && (1..=12).contains(&m)).then_some((d, m))
}

/// Mots du titre (séparés par des espaces ou `_`), sans l'identifiant final d'Openrunner.
fn words(name: &str) -> Vec<String> {
    let mut s = name.replace('_', " ");
    // « …-15424659 » : identifiant de parcours ajouté par Openrunner.
    if let Some((head, tail)) = s.rsplit_once('-') {
        if tail.trim().len() >= 5 && tail.trim().chars().all(|c| c.is_ascii_digit()) && !head.trim().is_empty() {
            s = head.to_string();
        }
    }
    s.split_whitespace().map(str::to_string).collect()
}

/// Cherche une date dans les mots ; renvoie la date et les indices des mots qui la forment.
fn find_date(w: &[String]) -> Option<(NameDate, Vec<usize>)> {
    let digits = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    for (i, word) in w.iter().enumerate() {
        let parts: Vec<&str> = word.split(['-', '.', '/']).collect();
        if !parts.iter().all(|p| digits(p)) {
            continue;
        }
        match parts.as_slice() {
            // 2022-08-27
            [y, m, d] if is_year(y).is_some() => {
                if let Some((d, m)) = day_month(d, m) {
                    return Some((NameDate { year: is_year(y)?, month: Some(m), day: Some(d) }, vec![i]));
                }
            }
            // 27-08-2022, 27/08/2022
            [d, m, y] if is_year(y).is_some() => {
                if let Some((d, m)) = day_month(d, m) {
                    return Some((NameDate { year: is_year(y)?, month: Some(m), day: Some(d) }, vec![i]));
                }
            }
            // 20220827
            [s] if s.len() == 8 && is_year(&s[..4]).is_some() => {
                if let Some((d, m)) = day_month(&s[6..], &s[4..6]) {
                    return Some((NameDate { year: is_year(&s[..4])?, month: Some(m), day: Some(d) }, vec![i]));
                }
            }
            // 2022 seul, ou suivi du jour et du mois (« 2022 2708 », Openrunner)
            [y] if is_year(y).is_some() => {
                let year = is_year(y)?;
                if let Some(next) = w.get(i + 1).filter(|n| n.len() == 4 && digits(n)) {
                    if let Some((d, m)) = day_month(&next[..2], &next[2..]) {
                        return Some((NameDate { year, month: Some(m), day: Some(d) }, vec![i, i + 1]));
                    }
                }
                return Some((NameDate { year, month: None, day: None }, vec![i]));
            }
            _ => {}
        }
    }
    None
}

/// Identifiant de parcours en fin de titre (« …-15424659 », ajouté par Openrunner).
pub fn route_id(name: &str) -> Option<String> {
    let (head, tail) = name.rsplit_once('-')?;
    let tail = tail.trim();
    (tail.len() >= 5 && tail.chars().all(|c| c.is_ascii_digit()) && !head.trim().is_empty()).then(|| tail.to_string())
}

/// Ligne ajoutée aux notes pour garder l'identifiant retiré du nom.
pub fn route_id_note(id: &str, creator: Option<&str>) -> String {
    if creator.is_some_and(|c| c.to_lowercase().contains("openrunner")) {
        format!("Openrunner : https://www.openrunner.com/route-details/{id}")
    } else {
        format!("Identifiant d’origine : {id}")
    }
}

/// Date écrite dans le titre, s'il y en a une.
pub fn date_in_name(name: &str) -> Option<NameDate> {
    find_date(&words(name)).map(|(d, _)| d)
}

/// Nom de fichier lisible : sans `_`, sans identifiant Openrunner ni date.
/// Si rien ne reste, le nom d'origine (sans `_`).
pub fn clean_name(name: &str) -> String {
    let mut w = words(name);
    if let Some((_, idx)) = find_date(&w) {
        for i in idx.into_iter().rev() {
            w.remove(i);
        }
    }
    // Séparateurs orphelins laissés par le retrait (« BRM 600 - Tour » reste lisible).
    let cleaned = w
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| c == '-' || c == '–' || c == ',' || c.is_whitespace())
        .to_string();
    if cleaned.chars().any(char::is_alphanumeric) {
        cleaned
    } else {
        name.replace('_', " ").split_whitespace().collect::<Vec<_>>().join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openrunner() {
        let n = "Le_Mythique_SBC_SPIDER_2022_2708-15424659";
        assert_eq!(clean_name(n), "Le Mythique SBC SPIDER");
        assert_eq!(date_in_name(n), Some(NameDate { year: 2022, month: Some(8), day: Some(27) }));
        let n = "BRM 600 _ Tour de Manche 2027-24118757";
        assert_eq!(clean_name(n), "BRM 600 Tour de Manche");
        assert_eq!(date_in_name(n).map(|d| d.year), Some(2027));
    }

    #[test]
    fn autres_formats() {
        assert_eq!(date_in_name("Sortie 2025-06-14 Vexin").and_then(|d| d.month), Some(6));
        assert_eq!(date_in_name("Sortie 14/06/2025").and_then(|d| d.day), Some(14));
        assert_eq!(date_in_name("20250614_sortie").map(|d| d.year), Some(2025));
        assert_eq!(clean_name("Sortie 2025-06-14 Vexin"), "Sortie Vexin");
        // Pas de date : rien ne change, sauf les « _ ».
        assert_eq!(date_in_name("BRM 600 km"), None);
        assert_eq!(clean_name("np#614 super_chill gravel"), "np#614 super chill gravel");
        // Un titre qui n'est qu'une date reste lisible.
        assert_eq!(clean_name("2025-06-14"), "2025-06-14");
        assert!(date_in_name("2022 2708").unwrap().timestamp().is_some());
    }
}
