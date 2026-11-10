//! Tags détectés dans le titre et les métadonnées d'un GPX (`<desc>`,
//! `<keywords>`…). Ils sont seulement **proposés** : l'utilisateur les valide
//! sur la fiche ou à l'import.

/// Mot (ou début de mot) reconnu → tag proposé.
const WORDS: &[(&str, &str)] = &[
    ("brevet", "Brevet"),
    ("audax", "Audax"),
    ("flèche", "Flèche"),
    ("fleche", "Flèche"),
    ("permanent", "Permanent"),
    ("diagonale", "Diagonale"),
    ("pbp", "PBP"),
    ("paris-brest-paris", "PBP"),
    ("bpf", "BPF"),
    ("cyclosportive", "Cyclosportive"),
    ("bikepacking", "Bikepacking"),
    ("ultra", "Ultra"),
    ("gravel", "Gravel"),
    ("vtt", "VTT"),
    ("randonnée", "Randonnée"),
    ("rando", "Randonnée"),
    ("trail", "Trail"),
    ("boucle", "Boucle"),
    ("nocturne", "Nocturne"),
    ("rallye", "Rallye"),
    ("étape", "Étape"),
    ("etape", "Étape"),
    ("club", "Club"),
];

/// Distances officielles des brevets randonneurs (BRM).
const BRM_DISTANCES: &[&str] = &["200", "300", "400", "600", "1000", "1200"];

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '-'))
        .flat_map(|w| {
            // « paris-brest-paris » reste entier, mais « Rando-Gravel » donne aussi ses deux mots.
            let mut v = vec![w.trim_matches('-').to_string()];
            if w.contains('-') {
                v.extend(w.split('-').map(str::to_string));
            }
            v
        })
        .filter(|w| !w.is_empty())
        .collect()
}

fn push(out: &mut Vec<String>, tag: &str) {
    let tag = tag.trim();
    if !tag.is_empty() && tag.chars().count() <= 40 && !out.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
        out.push(tag.to_string());
    }
}

/// Tags proposés pour une trace, d'après son titre (brut, avant nettoyage),
/// sa description et ses mots-clés GPX.
pub fn suggest(title: &str, description: Option<&str>, keywords: Option<&str>) -> Vec<String> {
    let mut out = Vec::new();
    for text in [Some(title), description].into_iter().flatten() {
        let w = words(&text.replace('_', " "));
        for (i, word) in w.iter().enumerate() {
            if word == "brm" {
                push(&mut out, "BRM");
                if let Some(d) = w.get(i + 1).filter(|n| BRM_DISTANCES.contains(&n.as_str())) {
                    push(&mut out, &format!("BRM {d}"));
                }
            }
            if let Some((_, tag)) = WORDS.iter().find(|(k, _)| word == k) {
                push(&mut out, tag);
            }
        }
    }
    // Mots-clés du GPX : repris tels quels.
    if let Some(k) = keywords {
        for kw in k.split([',', ';']) {
            push(&mut out, kw);
        }
    }
    out
}

/// Texte où chercher les tags de l'utilisateur : titre brut, description, mots-clés.
pub fn hint_text(title: &str, description: Option<&str>, keywords: Option<&str>) -> String {
    [Some(title), description, keywords].into_iter().flatten().collect::<Vec<_>>().join("\n")
}

/// Le tag (choisi par l'utilisateur pour la détection) apparaît-il dans le texte ?
/// Sans tenir compte de la casse, au début d'un mot ; s'il finit par une lettre ou
/// un chiffre, aussi en fin de mot : « NP# » trouve « np#614 », « Club » ne trouve
/// pas « Clubber ». Les `_` comptent comme des espaces.
pub fn text_has_tag(text: &str, tag: &str) -> bool {
    let tag = tag.trim().to_lowercase();
    if tag.is_empty() {
        return false;
    }
    let text = text.to_lowercase().replace('_', " ");
    let ends_alnum = tag.chars().last().is_some_and(char::is_alphanumeric);
    let mut from = 0;
    while let Some(pos) = text[from..].find(&tag) {
        let start = from + pos;
        let end = start + tag.len();
        let before_ok = text[..start].chars().last().is_none_or(|c| !c.is_alphanumeric());
        let after_ok = !ends_alnum || text[end..].chars().next().is_none_or(|c| !c.is_alphanumeric());
        if before_ok && after_ok {
            return true;
        }
        from = start + text[start..].chars().next().map_or(1, char::len_utf8);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_de_l_utilisateur() {
        assert!(text_has_tag("np#614 super chill gravel", "NP#"));
        assert!(text_has_tag("Proposition np#561 Gravel", "NP#"));
        assert!(!text_has_tag("Snp#1", "NP#"));
        assert!(text_has_tag("Sortie_Club_du_dimanche", "Club"));
        assert!(!text_has_tag("Clubber", "Club"));
        assert!(text_has_tag("Tour de Manche 2027", "tour de manche"));
        assert!(text_has_tag("Été en Normandie", "été"));
    }

    #[test]
    fn titres() {
        assert_eq!(suggest("BRM 600 _ Tour de Manche 2027-24118757", None, None), vec!["BRM", "BRM 600"]);
        assert_eq!(suggest("np#614 super chill gravel", None, None), vec!["Gravel"]);
        assert_eq!(suggest("Rando-Gravel du club", None, None), vec!["Randonnée", "Gravel", "Club"]);
        assert!(suggest("Le_Mythique_SBC_SPIDER_2022_2708", None, None).is_empty());
        // « Clubber » ou « gravelle » ne sont pas « Club » ou « Gravel ».
        assert!(suggest("Clubber à la gravelle", None, None).is_empty());
    }

    #[test]
    fn metadonnees() {
        let t = suggest("Sortie", Some("Brevet de 200 km, parcours BRM 200"), Some("Normandie; côte , BRM"));
        assert_eq!(t, vec!["Brevet", "BRM", "BRM 200", "Normandie", "côte"]);
    }
}
