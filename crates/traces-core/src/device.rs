//! Préparation d'une trace pour un compteur GPS (Hammerhead Karoo).
//!
//! Comme Pédalons : un Karoo ne garde les points d'intérêt d'un GPX envoyé par
//! l'API que si leur `<type>` et leur `<sym>` sont l'une de ses neuf valeurs
//! (Food, Water, Parking, Camping, Lodging, Geocache, Summit, Generic, Danger) ;
//! et il nomme le parcours d'après le nom du fichier envoyé.

use std::path::Path;

use crate::analyze::classify_poi;
use crate::model::PoiKind;
use crate::{Error, Result};

/// Catégorie Hammerhead d'un point d'intérêt Organisons.
pub fn hammerhead_type(kind: PoiKind) -> &'static str {
    match kind {
        PoiKind::Control => "Generic",
        PoiKind::Warning => "Danger",
        PoiKind::Water => "Water",
        PoiKind::Shop => "Food",
        PoiKind::Sight => "Summit",
        PoiKind::Other => "Generic",
    }
}

/// GPX à envoyer au Karoo : la trace telle quelle, et les points d'intérêt avec
/// un type et un symbole qu'il comprend (noms, descriptions et positions gardés).
/// Le fichier d'origine n'est pas modifié.
pub fn hammerhead_gpx(path: &Path) -> Result<Vec<u8>> {
    let file = std::fs::File::open(path).map_err(|source| Error::Io { path: path.to_owned(), source })?;
    let mut gpx = gpx::read(std::io::BufReader::new(file))
        .map_err(|e| Error::Invalid(format!("{} : GPX illisible ({e})", path.display())))?;
    for w in &mut gpx.waypoints {
        let kind = classify_poi(w.symbol.as_deref(), w.name.as_deref().unwrap_or(""));
        let t = hammerhead_type(kind).to_string();
        w.symbol = Some(t.clone());
        w.type_ = Some(t);
    }
    let mut out = Vec::new();
    gpx::write(&gpx, &mut out).map_err(|e| Error::Invalid(format!("écriture du GPX impossible ({e})")))?;
    Ok(out)
}

/// Nom de fichier affiché par le Karoo : accents retirés, seuls les lettres,
/// chiffres, espaces, points, tirets et soulignés gardés.
pub fn device_file_name(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        let base = match c {
            'à' | 'â' | 'ä' | 'á' | 'ã' => 'a',
            'À' | 'Â' | 'Ä' | 'Á' | 'Ã' => 'A',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'É' | 'È' | 'Ê' | 'Ë' => 'E',
            'î' | 'ï' | 'í' | 'ì' => 'i',
            'Î' | 'Ï' | 'Í' | 'Ì' => 'I',
            'ô' | 'ö' | 'ó' | 'ò' | 'õ' => 'o',
            'Ô' | 'Ö' | 'Ó' | 'Ò' | 'Õ' => 'O',
            'ù' | 'û' | 'ü' | 'ú' => 'u',
            'Ù' | 'Û' | 'Ü' | 'Ú' => 'U',
            'ç' => 'c',
            'Ç' => 'C',
            'ñ' => 'n',
            'Ñ' => 'N',
            '·' | '–' | '—' => '-',
            c => c,
        };
        if base.is_ascii_alphanumeric() || " ._-".contains(base) {
            out.push(base);
        } else if c == 'œ' {
            out.push_str("oe");
        } else {
            out.push(' ');
        }
    }
    let s = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.is_empty() { "Parcours".into() } else { s }
}

/// Corps multipart/form-data avec un seul fichier (champ `file`).
pub fn multipart_file(boundary: &str, file_name: &str, content_type: &str, bytes: &[u8]) -> Vec<u8> {
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {content_type}\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noms_de_fichier() {
        assert_eq!(device_file_name("Montée de l'Alpe d'Huez"), "Montee de l Alpe d Huez");
        assert_eq!(device_file_name("BRM 600 · Tour de Manche"), "BRM 600 - Tour de Manche");
        assert_eq!(device_file_name("np#614 \"chill\""), "np 614 chill");
        assert_eq!(device_file_name("???"), "Parcours");
    }

    #[test]
    fn corps_multipart() {
        let b = multipart_file("XYZ", "a.gpx", "application/gpx+xml", b"<gpx/>");
        let s = String::from_utf8(b).unwrap();
        assert!(s.starts_with("--XYZ\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.gpx\""));
        assert!(s.ends_with("<gpx/>\r\n--XYZ--\r\n"));
    }
}
