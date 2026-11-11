//! Tags et notes d'Organisons enregistrés dans le fichier GPX lui-même.
//!
//! Le bloc est placé dans les `<extensions>` de l'élément `<gpx>` (GPX 1.1) :
//!
//! ```xml
//! <extensions>
//!   <organisons:meta xmlns:organisons="https://github.com/minicake1/organisons/gpx/1">
//!     <organisons:tag>BRM</organisons:tag>
//!     <organisons:notes>Départ à 6 h</organisons:notes>
//!   </organisons:meta>
//! </extensions>
//! ```
//!
//! Le reste du fichier est conservé octet pour octet : on ne réécrit pas le
//! GPX avec un parseur, qui perdrait les extensions d'Openrunner, Garmin, etc.

use std::fs;
use std::path::Path;

use crate::error::{Error, Result};

pub const NAMESPACE: &str = "https://github.com/minicake1/organisons/gpx/1";
const OPEN: &str = "<organisons:meta";
const CLOSE: &str = "</organisons:meta>";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GpxMeta {
    pub tags: Vec<String>,
    pub notes: String,
}

/// Lit le bloc Organisons d'un GPX, s'il existe.
pub fn read_meta(xml: &str) -> Option<GpxMeta> {
    let start = xml.find(OPEN)?;
    let end = xml[start..].find(CLOSE)? + start;
    let block = &xml[start..end];
    let mut meta = GpxMeta::default();
    for (open, close) in [("<organisons:tag>", "</organisons:tag>"), ("<organisons:notes>", "</organisons:notes>")] {
        let mut rest = block;
        while let Some(i) = rest.find(open) {
            let after = &rest[i + open.len()..];
            let Some(j) = after.find(close) else { break };
            let value = unescape(&after[..j]);
            if open.contains("tag") {
                if !value.trim().is_empty() {
                    meta.tags.push(value.trim().to_string());
                }
            } else {
                meta.notes = value;
            }
            rest = &after[j + close.len()..];
        }
    }
    Some(meta)
}

/// Lit le bloc Organisons d'un fichier (absent, illisible ou non UTF-8 → `None`).
pub fn read_meta_file(path: &Path) -> Option<GpxMeta> {
    fs::read_to_string(path).ok().as_deref().and_then(read_meta)
}

/// Renvoie le GPX avec le bloc Organisons ajouté, remplacé ou retiré
/// (retiré si tags et notes sont vides).
pub fn with_meta(xml: &str, meta: &GpxMeta) -> std::result::Result<String, String> {
    let empty = meta.tags.is_empty() && meta.notes.trim().is_empty();
    let block = if empty { String::new() } else { render(meta) };

    // Bloc déjà présent : on le remplace sur place.
    if let Some(start) = xml.find(OPEN) {
        let end = xml[start..].find(CLOSE).ok_or("bloc organisons:meta non fermé")? + start + CLOSE.len();
        return Ok(format!("{}{}{}", &xml[..start], block, &xml[end..]));
    }
    if empty {
        return Ok(xml.to_string());
    }

    let close = xml.rfind("</gpx>").ok_or("balise </gpx> introuvable")?;
    let gpx_start = xml.find("<gpx").ok_or("balise <gpx> introuvable")?;
    let gpx_tag_end = xml[gpx_start..].find('>').map(|i| gpx_start + i).unwrap_or(close);
    let gpx_tag = &xml[gpx_start..gpx_tag_end];
    let before = xml[..close].trim_end();
    let indent = "\n  ";

    if gpx_tag.contains("version=\"1.0\"") || gpx_tag.contains("version='1.0'") {
        // GPX 1.0 : pas d'<extensions>, les éléments d'un autre espace de noms sont admis directement.
        return Ok(format!("{before}{indent}{block}\n{}", &xml[close..]));
    }
    if let Some(stripped) = before.strip_suffix("</extensions>") {
        // Le dernier enfant de <gpx> est déjà un <extensions> : on y ajoute notre bloc.
        let rest = &xml[stripped.len()..];
        return Ok(format!("{}{indent}  {block}{indent}{rest}", stripped.trim_end()));
    }
    Ok(format!("{before}{indent}<extensions>{indent}  {block}{indent}</extensions>\n{}", &xml[close..]))
}

/// Écrit tags et notes dans le fichier, de façon sûre : le nouveau contenu
/// doit se relire comme un GPX valide avec le même nombre de points, puis il
/// remplace l'ancien d'un seul coup (fichier temporaire + renommage).
pub fn write_meta_file(path: &Path, meta: &GpxMeta) -> Result<bool> {
    rewrite(path, |xml| with_meta(xml, meta).map_err(|e| e.to_string()))
}

/// Remplace le contenu d'un `<name>` situé entre `from` et `until` (s'il y en a
/// un), sinon renvoie `None`.
fn replace_name_between(xml: &str, from: usize, until: usize, escaped: &str) -> Option<String> {
    let start = xml[from..until].find("<name>")? + from + "<name>".len();
    let end = xml[start..until].find("</name>")? + start;
    Some(format!("{}{escaped}{}", &xml[..start], &xml[end..]))
}

/// Renvoie le GPX avec un nouveau nom : `<name>` de la première piste (ou du
/// premier itinéraire), ajouté s'il manque, et celui des métadonnées s'il existe.
/// Le reste du fichier est inchangé.
pub fn with_name(xml: &str, name: &str) -> std::result::Result<String, String> {
    let escaped = escape(name.trim());
    if escaped.is_empty() {
        return Err("nom vide".into());
    }
    let mut out = xml.to_string();
    // Piste, sinon itinéraire : le nom est avant les segments ou les points.
    let block = [("<trk>", "<trk ", "<trkseg"), ("<rte>", "<rte ", "<rtept")]
        .into_iter()
        .find_map(|(a, b, body)| out.find(a).or_else(|| out.find(b)).map(|s| (s, body)));
    let Some((start, body)) = block else { return Err("ni piste ni itinéraire dans le GPX".into()) };
    let tag_end = out[start..].find('>').ok_or("balise de piste non fermée")? + start + 1;
    let until = out[tag_end..].find(body).map(|i| i + tag_end).unwrap_or(out.len());
    out = match replace_name_between(&out, tag_end, until, &escaped) {
        Some(s) => s,
        None => format!("{}<name>{escaped}</name>{}", &out[..tag_end], &out[tag_end..]),
    };
    // Métadonnées : seulement si elles ont déjà un nom, qui est alors leur premier
    // élément (ordre du GPX 1.1) ; jamais le <name> de <author>.
    if let Some(start) = metadata_name_start(&out) {
        let end = out[start..].find("</name>").map(|e| e + start).ok_or("nom des métadonnées non fermé")?;
        out = format!("{}{escaped}{}", &out[..start], &out[end..]);
    }
    Ok(out)
}

/// Début du texte du `<name>` propre aux métadonnées (leur premier élément), s'il existe.
pub(crate) fn metadata_name_start(xml: &str) -> Option<usize> {
    let m = xml.find("<metadata")?;
    let tag_end = xml[m..].find('>')? + m + 1;
    let rest = &xml[tag_end..];
    let skipped = rest.len() - rest.trim_start().len();
    rest.trim_start().starts_with("<name>").then_some(tag_end + skipped + "<name>".len())
}

/// Écrit un nouveau nom dans le GPX (piste et métadonnées). Renvoie `true` si le fichier a changé.
pub fn write_name_file(path: &Path, name: &str) -> Result<bool> {
    rewrite(path, |xml| with_name(xml, name))
}

/// Réécrit un GPX par une modification textuelle, vérifiée : UTF-8, relecture
/// possible, même nombre de points ; fichier temporaire puis renommage.
fn rewrite(path: &Path, change: impl FnOnce(&str) -> std::result::Result<String, String>) -> Result<bool> {
    rewrite_counted(path, 0, change)
}

/// Comme `rewrite`, avec `delta` points d'intérêt de plus (ajouts) ou de moins (suppressions).
fn rewrite_counted(path: &Path, delta: i64, change: impl FnOnce(&str) -> std::result::Result<String, String>) -> Result<bool> {
    let io = |source| Error::Io { path: path.to_owned(), source };
    let fail = |message: String| Error::Gpx { path: path.to_owned(), message };
    let bytes = fs::read(path).map_err(io)?;
    let xml = String::from_utf8(bytes)
        .map_err(|_| fail("encodage autre que UTF-8 : écriture dans le GPX impossible".into()))?;
    let new = change(&xml).map_err(fail)?;
    if new == xml {
        return Ok(false);
    }
    let count = |s: &str| -> std::result::Result<usize, String> {
        let g = gpx::read(s.as_bytes()).map_err(|e| e.to_string())?;
        Ok(g.tracks.iter().flat_map(|t| &t.segments).map(|s| s.points.len()).sum::<usize>()
            + g.routes.iter().map(|r| r.points.len()).sum::<usize>()
            + g.waypoints.len())
    };
    let before = count(&xml).map_err(fail)?;
    let after = count(&new).map_err(|e| fail(format!("le GPX modifié ne se relit pas ({e}), fichier laissé intact")))?;
    if before as i64 + delta != after as i64 {
        return Err(fail("le GPX modifié n'a pas le nombre de points attendu, fichier laissé intact".into()));
    }
    let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{file_name}.organisons.tmp"));
    fs::write(&tmp, new.as_bytes()).map_err(|source| Error::Io { path: tmp.clone(), source })?;
    if let Err(source) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(io(source));
    }
    Ok(true)
}

fn render(meta: &GpxMeta) -> String {
    let mut s = format!("<organisons:meta xmlns:organisons=\"{NAMESPACE}\">");
    for t in &meta.tags {
        s.push_str(&format!("<organisons:tag>{}</organisons:tag>", escape(t)));
    }
    if !meta.notes.trim().is_empty() {
        s.push_str(&format!("<organisons:notes>{}</organisons:notes>", escape(&meta.notes)));
    }
    s.push_str(CLOSE);
    s
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

// ---------------------------------------------------------------------------
// Points d'intérêt (`<wpt>`) : modifiés dans le texte du GPX, le reste du
// fichier gardé tel quel. Un POI est désigné par sa position et son nom
// (`index::poi_key`), comme dans l'index.

/// Modification d'un point d'intérêt. `lat`, `lon`, `name` : le POI tel qu'il
/// est dans le fichier (pour `Add` : le nouveau POI).
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum WptEdit {
    Add { lat: f64, lon: f64, name: String },
    Rename { lat: f64, lon: f64, name: String, new_name: String },
    Move { lat: f64, lon: f64, name: String, to_lat: f64, to_lon: f64 },
    Delete { lat: f64, lon: f64, name: String },
}

struct WptSpan {
    start: usize,
    /// Fin de la balise ouvrante (après `>`).
    open_end: usize,
    end: usize,
    self_closing: bool,
    lat: f64,
    lon: f64,
    name: String,
    /// Contenu de `<name>` (début, fin), s'il existe.
    name_span: Option<(usize, usize)>,
}

/// Position de la valeur de l'attribut `key` dans une balise ouvrante.
fn attr(tag: &str, key: &str) -> Option<(usize, usize)> {
    let mut from = 0;
    while let Some(i) = tag[from..].find(key).map(|i| i + from) {
        let before_ok = i > 0 && tag.as_bytes()[i - 1].is_ascii_whitespace();
        let rest = tag[i + key.len()..].trim_start();
        if before_ok && rest.starts_with('=') {
            let after_eq = rest[1..].trim_start();
            let q = after_eq.chars().next()?;
            if q == '"' || q == '\'' {
                let vstart = tag.len() - after_eq.len() + 1;
                let vend = vstart + tag[vstart..].find(q)?;
                return Some((vstart, vend));
            }
        }
        from = i + key.len();
    }
    None
}

fn wpt_spans(xml: &str) -> Vec<WptSpan> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(start) = xml[from..].find("<wpt").map(|i| i + from) {
        let next = xml.as_bytes().get(start + 4).copied().unwrap_or(b'>');
        if !(next == b'>' || next.is_ascii_whitespace() || next == b'/') {
            from = start + 4;
            continue;
        }
        let Some(gt) = xml[start..].find('>').map(|i| i + start) else { break };
        let open_end = gt + 1;
        let tag = &xml[start..open_end];
        let self_closing = xml[..gt].ends_with('/');
        let end = if self_closing {
            open_end
        } else {
            match xml[open_end..].find("</wpt>") {
                Some(i) => open_end + i + "</wpt>".len(),
                None => break,
            }
        };
        let num = |k: &str| attr(tag, k).and_then(|(a, b)| tag[a..b].trim().parse::<f64>().ok());
        if let (Some(lat), Some(lon)) = (num("lat"), num("lon")) {
            let inner = if self_closing { "" } else { &xml[open_end..end - "</wpt>".len()] };
            let name_span = inner.find("<name>").and_then(|a| {
                let a = a + "<name>".len();
                inner[a..].find("</name>").map(|b| (open_end + a, open_end + a + b))
            });
            let name = name_span.map(|(a, b)| {
                let raw = xml[a..b].trim();
                let raw = match raw.strip_prefix("<![CDATA[").and_then(|r| r.strip_suffix("]]>")) {
                    Some(r) => r.to_string(),
                    None => unescape(raw),
                };
                raw.trim().to_string()
            });
            out.push(WptSpan { start, open_end, end, self_closing, lat, lon, name: name.unwrap_or_default(), name_span });
        }
        from = end;
    }
    out
}

fn coord(x: f64) -> String {
    let s = format!("{x:.7}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn find_wpt(xml: &str, lat: f64, lon: f64, name: &str) -> std::result::Result<WptSpan, String> {
    let key = crate::index::poi_key(lat, lon, name.trim());
    wpt_spans(xml)
        .into_iter()
        .find(|w| crate::index::poi_key(w.lat, w.lon, &w.name) == key)
        .ok_or_else(|| format!("point d'intérêt « {name} » introuvable dans le fichier (modifié ailleurs ? relis les dossiers)"))
}

/// Indentation de la ligne où commence `at`.
fn indent_at(xml: &str, at: usize) -> &str {
    let line = xml[..at].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let ws = &xml[line..at];
    if ws.chars().all(|c| c == ' ' || c == '\t') {
        ws
    } else {
        ""
    }
}

/// Applique une modification de POI au texte d'un GPX.
pub fn with_wpt_edit(xml: &str, edit: &WptEdit) -> std::result::Result<String, String> {
    let name_tag = |n: &str| format!("<name>{}</name>", escape(n.trim()));
    match edit {
        WptEdit::Add { lat, lon, name } => {
            let element = format!("<wpt lat=\"{}\" lon=\"{}\">{}</wpt>", coord(*lat), coord(*lon), name_tag(name));
            // GPX 1.1 : les <wpt> avant <rte> et <trk> ; à la suite des autres s'il y en a.
            if let Some(last) = wpt_spans(xml).last() {
                let indent = indent_at(xml, last.start);
                return Ok(format!("{}\n{indent}{element}{}", &xml[..last.end], &xml[last.end..]));
            }
            let anchor = ["<rte>", "<rte ", "<trk>", "<trk ", "<extensions>", "</gpx>"]
                .iter()
                .filter_map(|t| xml.find(t))
                .min()
                .ok_or("élément <gpx> introuvable")?;
            let indent = indent_at(xml, anchor);
            Ok(format!("{}{element}\n{indent}{}", &xml[..anchor], &xml[anchor..]))
        }
        WptEdit::Rename { lat, lon, name, new_name } => {
            let w = find_wpt(xml, *lat, *lon, name)?;
            Ok(match (w.name_span, w.self_closing) {
                (Some((a, b)), _) => format!("{}{}{}", &xml[..a], escape(new_name.trim()), &xml[b..]),
                (None, false) => format!("{}{}{}", &xml[..w.open_end], name_tag(new_name), &xml[w.open_end..]),
                (None, true) => {
                    let open = xml[w.start..w.open_end].trim_end_matches('>').trim_end_matches('/').trim_end();
                    format!("{}{open}>{}</wpt>{}", &xml[..w.start], name_tag(new_name), &xml[w.end..])
                }
            })
        }
        WptEdit::Move { lat, lon, name, to_lat, to_lon } => {
            let w = find_wpt(xml, *lat, *lon, name)?;
            let mut tag = xml[w.start..w.open_end].to_string();
            for (k, v) in [("lat", to_lat), ("lon", to_lon)] {
                let (a, b) = attr(&tag, k).ok_or("attribut de position illisible")?;
                tag.replace_range(a..b, &coord(*v));
            }
            Ok(format!("{}{tag}{}", &xml[..w.start], &xml[w.open_end..]))
        }
        WptEdit::Delete { lat, lon, name } => {
            let w = find_wpt(xml, *lat, *lon, name)?;
            // Avec l'indentation et le retour à la ligne qui le précèdent.
            let indent = indent_at(xml, w.start);
            let mut start = w.start - indent.len();
            if start > 0 && xml[..start].ends_with('\n') {
                start -= 1;
                if xml[..start].ends_with('\r') {
                    start -= 1;
                }
            }
            Ok(format!("{}{}", &xml[..start], &xml[w.end..]))
        }
    }
}

/// Applique des modifications de POI à un fichier GPX (vérifié, atomique).
pub fn edit_wpts_file(path: &Path, edits: &[WptEdit]) -> Result<bool> {
    let delta = edits
        .iter()
        .map(|e| match e {
            WptEdit::Add { .. } => 1,
            WptEdit::Delete { .. } => -1,
            _ => 0,
        })
        .sum();
    rewrite_counted(path, delta, |xml| edits.iter().try_fold(xml.to_string(), |x, e| with_wpt_edit(&x, e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renommage() {
        let x = "<gpx><metadata><name>Ancien</name></metadata><trk><name>Ancien</name><trkseg><trkpt lat=\"1\" lon=\"2\"><name>pt</name></trkpt></trkseg></trk></gpx>";
        let y = with_name(x, "Boucle & Vexin").unwrap();
        assert_eq!(
            y,
            "<gpx><metadata><name>Boucle &amp; Vexin</name></metadata><trk><name>Boucle &amp; Vexin</name><trkseg><trkpt lat=\"1\" lon=\"2\"><name>pt</name></trkpt></trkseg></trk></gpx>"
        );
        // Piste sans nom : il est ajouté ; le nom d'un point n'est pas touché.
        let x = "<gpx><trk><trkseg><trkpt lat=\"1\" lon=\"2\"><name>pt</name></trkpt></trkseg></trk></gpx>";
        assert_eq!(with_name(x, "Neuf").unwrap(), "<gpx><trk><name>Neuf</name><trkseg><trkpt lat=\"1\" lon=\"2\"><name>pt</name></trkpt></trkseg></trk></gpx>");
        // Itinéraire (Openrunner, Komoot) et métadonnées sans nom.
        let x = "<gpx><metadata><time>t</time></metadata><rte><name>A</name><rtept lat=\"1\" lon=\"2\"/></rte></gpx>";
        assert_eq!(with_name(x, "B").unwrap(), "<gpx><metadata><time>t</time></metadata><rte><name>B</name><rtept lat=\"1\" lon=\"2\"/></rte></gpx>");
        assert!(with_name(x, "  ").is_err());
        // Métadonnées sans nom mais avec un auteur : l'auteur n'est pas touché.
        let x = "<gpx><metadata>\n  <author><name>Jean</name></author></metadata><trk><name>A</name><trkseg/></trk></gpx>";
        assert_eq!(with_name(x, "B").unwrap(), "<gpx><metadata>\n  <author><name>Jean</name></author></metadata><trk><name>B</name><trkseg/></trk></gpx>");
    }

    const GPX11: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Boucle</name><trkseg>
    <trkpt lat="48.0" lon="2.0"><ele>100</ele></trkpt>
    <trkpt lat="48.01" lon="2.0"><ele>110</ele></trkpt>
  </trkseg></trk>
</gpx>
"#;

    fn meta(tags: &[&str], notes: &str) -> GpxMeta {
        GpxMeta { tags: tags.iter().map(|s| s.to_string()).collect(), notes: notes.into() }
    }

    #[test]
    fn ajout_lecture_remplacement_retrait() {
        let m = meta(&["BRM", "Été & soleil"], "Départ <6 h>");
        let a = with_meta(GPX11, &m).unwrap();
        assert!(a.contains("<extensions>"));
        assert!(gpx::read(a.as_bytes()).is_ok());
        assert_eq!(read_meta(&a), Some(m));

        let m2 = meta(&["Gravel"], "");
        let b = with_meta(&a, &m2).unwrap();
        assert_eq!(read_meta(&b), Some(m2));
        assert_eq!(b.matches(OPEN).count(), 1);

        let c = with_meta(&b, &GpxMeta::default()).unwrap();
        assert_eq!(read_meta(&c), None);
        assert!(gpx::read(c.as_bytes()).is_ok());
        assert!(c.contains("<trkpt lat=\"48.01\""));
    }

    #[test]
    fn extensions_existantes_conservees() {
        let src = GPX11.replace("</gpx>", "  <extensions><x:a xmlns:x=\"urn:x\">1</x:a></extensions>\n</gpx>");
        let out = with_meta(&src, &meta(&["A"], "")).unwrap();
        assert_eq!(out.matches("<extensions>").count(), 1);
        assert!(out.contains("<x:a xmlns:x=\"urn:x\">1</x:a>"));
        assert!(gpx::read(out.as_bytes()).is_ok());
    }

    #[test]
    fn gpx_10_sans_extensions() {
        let src = GPX11.replace("version=\"1.1\"", "version=\"1.0\"").replace("GPX/1/1", "GPX/1/0");
        let out = with_meta(&src, &meta(&["A"], "")).unwrap();
        assert!(!out.contains("<extensions>"));
        assert_eq!(read_meta(&out).unwrap().tags, vec!["A"]);
    }

    #[test]
    fn ecriture_fichier() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.gpx");
        fs::write(&p, GPX11).unwrap();
        assert!(write_meta_file(&p, &meta(&["A"], "n")).unwrap());
        assert!(!write_meta_file(&p, &meta(&["A"], "n")).unwrap());
        assert_eq!(read_meta_file(&p).unwrap().notes, "n");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1, "pas de fichier temporaire laissé");
    }
}
