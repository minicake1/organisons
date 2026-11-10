//! Entraînements : séances structurées au format Zwift `.zwo` (XML).
//!
//! Une séance est une suite de blocs : échauffement et retour au calme (rampe),
//! paliers, intervalles répétés, rampes, roue libre, effort maximal. Les
//! puissances sont des fractions de la FTP (1.0 = 100 % FTP).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// Bloc d'une séance, à plat (les intervalles répétés sont déroulés).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    /// "warmup", "cooldown", "steady", "on", "off", "ramp", "free", "max"
    pub kind: String,
    /// Début, en secondes depuis le départ.
    pub start: u32,
    pub duration: u32,
    /// Puissance au début et à la fin du bloc (fraction de FTP) ; égales pour un palier.
    pub from: f64,
    pub to: f64,
    /// Cadence demandée (tr/min), si la séance la précise.
    pub cadence: Option<u32>,
}

/// Séance lue dans un `.zwo`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workout {
    pub name: String,
    pub author: String,
    pub description: String,
    /// "bike" ou "run"
    pub sport: String,
    pub tags: Vec<String>,
    /// Durée totale (s).
    pub duration: u32,
    /// Facteur d'intensité (puissance normalisée / FTP).
    pub intensity: f64,
    /// Charge d'entraînement estimée (TSS) : heures × IF² × 100.
    pub tss: f64,
    pub blocks: Vec<Block>,
}

fn attr_f(n: &roxmltree::Node, name: &str) -> Option<f64> {
    n.attribute(name).and_then(|v| v.trim().parse::<f64>().ok())
}

fn attr_u(n: &roxmltree::Node, name: &str) -> Option<u32> {
    attr_f(n, name).map(|v| v.max(0.0).round() as u32)
}

fn child_text(root: &roxmltree::Node, tag: &str) -> String {
    root.children()
        .find(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case(tag))
        .and_then(|c| c.text())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Lit une séance `.zwo` (texte XML).
pub fn parse_zwo(xml: &str, fallback_name: &str) -> Result<Workout> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| Error::Invalid(format!("séance .zwo illisible ({e})")))?;
    let root = doc.root_element();
    if !root.tag_name().name().eq_ignore_ascii_case("workout_file") {
        return Err(Error::Invalid("ce fichier n'est pas une séance Zwift (.zwo)".into()));
    }
    let name = child_text(&root, "name");
    let tags = root
        .children()
        .find(|c| c.tag_name().name().eq_ignore_ascii_case("tags"))
        .map(|t| {
            t.children()
                .filter(|c| c.is_element())
                .filter_map(|c| c.attribute("name").map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let body = root
        .children()
        .find(|c| c.tag_name().name().eq_ignore_ascii_case("workout"))
        .ok_or_else(|| Error::Invalid("séance .zwo sans élément <workout>".into()))?;

    let mut blocks = Vec::new();
    let mut t = 0u32;
    let mut push = |kind: &str, duration: u32, from: f64, to: f64, cadence: Option<u32>, blocks: &mut Vec<Block>| {
        if duration > 0 {
            blocks.push(Block { kind: kind.into(), start: t, duration, from, to, cadence });
            t += duration;
        }
    };
    for n in body.children().filter(|c| c.is_element()) {
        let d = attr_u(&n, "Duration").unwrap_or(0);
        let cad = attr_u(&n, "Cadence");
        match n.tag_name().name() {
            "Warmup" | "Cooldown" | "Ramp" => {
                let lo = attr_f(&n, "PowerLow").unwrap_or(0.5);
                let hi = attr_f(&n, "PowerHigh").unwrap_or(lo);
                let kind = match n.tag_name().name() {
                    "Warmup" => "warmup",
                    "Cooldown" => "cooldown",
                    _ => "ramp",
                };
                push(kind, d, lo, hi, cad, &mut blocks);
            }
            "SteadyState" | "SolidState" => {
                let p = attr_f(&n, "Power").or_else(|| attr_f(&n, "PowerLow")).unwrap_or(0.6);
                push("steady", d, p, p, cad, &mut blocks);
            }
            "IntervalsT" => {
                let repeat = attr_u(&n, "Repeat").unwrap_or(1).max(1);
                let on_d = attr_u(&n, "OnDuration").unwrap_or(0);
                let off_d = attr_u(&n, "OffDuration").unwrap_or(0);
                let on_p = attr_f(&n, "OnPower").or_else(|| attr_f(&n, "PowerOnHigh")).unwrap_or(1.0);
                let off_p = attr_f(&n, "OffPower").or_else(|| attr_f(&n, "PowerOffLow")).unwrap_or(0.5);
                let on_c = attr_u(&n, "Cadence");
                let off_c = attr_u(&n, "CadenceResting");
                for _ in 0..repeat {
                    push("on", on_d, on_p, on_p, on_c, &mut blocks);
                    push("off", off_d, off_p, off_p, off_c, &mut blocks);
                }
            }
            "FreeRide" => push("free", d, 0.5, 0.5, cad, &mut blocks),
            "MaxEffort" => push("max", d, 1.5, 1.5, cad, &mut blocks),
            _ => {}
        }
    }
    let duration = t;
    // Puissance normalisée seconde par seconde (rampes interpolées) : (moyenne de p⁴)^¼.
    let mut sum4 = 0.0;
    for b in &blocks {
        for s in 0..b.duration {
            let f = if b.duration > 1 { s as f64 / (b.duration - 1) as f64 } else { 0.0 };
            let p = b.from + (b.to - b.from) * f;
            sum4 += p.powi(4);
        }
    }
    let intensity = if duration > 0 { (sum4 / duration as f64).powf(0.25) } else { 0.0 };
    let tss = duration as f64 / 3600.0 * intensity * intensity * 100.0;
    Ok(Workout {
        name: if name.is_empty() { fallback_name.to_string() } else { name },
        author: child_text(&root, "author"),
        description: child_text(&root, "description"),
        sport: {
            let s = child_text(&root, "sportType").to_lowercase();
            if s.is_empty() { "bike".into() } else { s }
        },
        tags,
        duration,
        intensity: (intensity * 100.0).round() / 100.0,
        tss: tss.round(),
        blocks,
    })
}

/// Lit un fichier `.zwo`.
pub fn read_zwo(path: &Path) -> Result<Workout> {
    let bytes = std::fs::read(path).map_err(|source| Error::Io { path: path.to_owned(), source })?;
    let text = String::from_utf8_lossy(&bytes);
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    parse_zwo(text.trim_start_matches('\u{feff}'), &stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEANCE: &str = r#"<?xml version="1.0"?>
<workout_file>
    <author>Organisons</author>
    <name>Seuil 3 × 8 min</name>
    <description>Trois blocs au seuil.</description>
    <sportType>bike</sportType>
    <tags><tag name="Seuil"/><tag name="FTP"/></tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <IntervalsT Repeat="3" OnDuration="480" OffDuration="240" OnPower="1.0" OffPower="0.55" Cadence="90"/>
        <SteadyState Duration="300" Power="0.65"/>
        <FreeRide Duration="60"/>
        <Cooldown Duration="300" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>"#;

    #[test]
    fn lecture_zwo() {
        let w = parse_zwo(SEANCE, "x").unwrap();
        assert_eq!(w.name, "Seuil 3 × 8 min");
        assert_eq!(w.tags, vec!["Seuil", "FTP"]);
        // 600 + 3 × (480 + 240) + 300 + 60 + 300
        assert_eq!(w.duration, 3420);
        assert_eq!(w.blocks.len(), 1 + 6 + 1 + 1 + 1);
        assert_eq!(w.blocks[1].kind, "on");
        assert_eq!(w.blocks[1].cadence, Some(90));
        assert_eq!(w.blocks[2].start, 600 + 480);
        assert!(w.intensity > 0.7 && w.intensity < 0.9, "{}", w.intensity);
        assert!(w.tss > 40.0 && w.tss < 70.0, "{}", w.tss);
    }

    #[test]
    fn erreurs() {
        assert!(parse_zwo("<gpx/>", "x").is_err());
        assert!(parse_zwo("pas du xml", "x").is_err());
        let w = parse_zwo("<workout_file><workout><SteadyState Duration='60' Power='1'/></workout></workout_file>", "Sans nom").unwrap();
        assert_eq!((w.name.as_str(), w.duration, w.tss), ("Sans nom", 60, 2.0));
    }
}
