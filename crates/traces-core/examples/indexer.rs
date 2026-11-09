//! Indexe un dossier de GPX en ligne de commande, sans interface.
//!
//! cargo run -p traces-core --example indexer -- <dossier> [base.sqlite]
//!
//! Sans base précisée, affiche simplement le résultat de l'analyse.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use traces_core::scan::scan_library;
use traces_core::{Index, TraceFilter};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().ok_or("usage : indexer <dossier> [base.sqlite]")?);
    let mut index = match args.next() {
        Some(db) => Index::open(&PathBuf::from(db))?,
        None => Index::open_in_memory()?,
    };
    let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "Bibliothèque".into());
    let lib = index.add_library(&name, &dir.to_string_lossy(), "index", "{sport}/{annee}/{nom}.gpx")?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;
    let report = scan_library(&mut index, &lib, now)?;
    println!(
        "{} ajoutée(s), {} mise(s) à jour, {} inchangée(s), {} retirée(s)",
        report.added, report.updated, report.unchanged, report.removed
    );
    for e in &report.errors {
        eprintln!("  erreur : {e}");
    }
    for t in index.list(&TraceFilter::default())? {
        println!(
            "{:>7.1} km  {:>5.0} m D+  {:<11} vent {:<2}  {} POI  {}",
            t.distance_km,
            t.elevation_gain,
            format!("{:?}", t.hilliness),
            t.wind.as_str(),
            t.poi_count,
            t.name
        );
    }
    Ok(())
}
