//! Tours : une collection dont les traces sont des étapes ordonnées. Export
//! en un seul GPX (une piste par étape) ou étape par étape dans un dossier.

use std::fs;
use std::path::{Path, PathBuf};

use crate::index::Index;
use crate::organize::sanitize;
use crate::{Error, Result};

fn read_gpx(path: &Path) -> Result<gpx::Gpx> {
    let file = fs::File::open(path).map_err(|source| Error::Io { path: path.to_owned(), source })?;
    gpx::read(std::io::BufReader::new(file)).map_err(|e| Error::Invalid(format!("{} : GPX illisible ({e})", path.display())))
}

fn tour_name(index: &Index, tour_id: i64) -> Result<String> {
    index
        .collections()?
        .into_iter()
        .find(|c| c.id == tour_id)
        .map(|c| c.name)
        .ok_or_else(|| Error::NotFound(format!("tour {tour_id}")))
}

/// Un seul GPX pour tout le tour : une piste par étape (« 01 - nom »), dans
/// l'ordre, et les points d'intérêt de toutes les étapes. Lisible par Garmin,
/// Komoot ou Openrunner. Les fichiers d'origine ne sont pas touchés.
pub fn export_tour_gpx(index: &Index, tour_id: i64, dest: &Path) -> Result<usize> {
    let name = tour_name(index, tour_id)?;
    let stages = index.tour_stages(tour_id)?;
    if stages.is_empty() {
        return Err(Error::Invalid("Ce tour n'a pas d'étape.".into()));
    }
    let mut out = gpx::Gpx {
        version: gpx::GpxVersion::Gpx11,
        creator: Some("Organisons".into()),
        metadata: Some(gpx::Metadata { name: Some(name), ..Default::default() }),
        ..Default::default()
    };
    for (i, stage) in stages.iter().enumerate() {
        let g = read_gpx(Path::new(&stage.summary.path))?;
        let label = format!("{:02} - {}", i + 1, stage.summary.name);
        let mut segments: Vec<gpx::TrackSegment> = g.tracks.into_iter().flat_map(|t| t.segments).collect();
        // Itinéraire sans piste (certains exports) : ses points deviennent un segment.
        if segments.iter().all(|s| s.points.is_empty()) {
            segments = g.routes.into_iter().map(|r| gpx::TrackSegment { points: r.points }).collect();
        }
        let mut track = gpx::Track::new();
        track.name = Some(label);
        track.segments = segments;
        out.tracks.push(track);
        out.waypoints.extend(g.waypoints);
    }
    let tmp = dest.with_extension("gpx.tmp");
    {
        let file = fs::File::create(&tmp).map_err(|source| Error::Io { path: tmp.clone(), source })?;
        gpx::write(&out, std::io::BufWriter::new(file)).map_err(|e| Error::Invalid(format!("écriture du GPX impossible ({e})")))?;
    }
    fs::rename(&tmp, dest).map_err(|source| Error::Io { path: dest.to_owned(), source })?;
    Ok(stages.len())
}

/// Copie chaque étape dans un dossier, numérotée : « 01 - nom.gpx », « 02 - … ».
/// Renvoie les fichiers créés. Un fichier déjà présent n'est pas écrasé.
pub fn export_tour_stages(index: &Index, tour_id: i64, dir: &Path) -> Result<Vec<String>> {
    let stages = index.tour_stages(tour_id)?;
    fs::create_dir_all(dir).map_err(|source| Error::Io { path: dir.to_owned(), source })?;
    let mut created = Vec::new();
    for (i, stage) in stages.iter().enumerate() {
        let base = format!("{:02} - {}", i + 1, sanitize(&crate::naming::clean_name(&stage.summary.name)));
        let mut to: PathBuf = dir.join(format!("{base}.gpx"));
        let mut n = 2;
        while to.exists() {
            to = dir.join(format!("{base} ({n}).gpx"));
            n += 1;
        }
        fs::copy(&stage.summary.path, &to).map_err(|source| Error::Io { path: to.clone(), source })?;
        created.push(to.to_string_lossy().to_string());
    }
    Ok(created)
}
