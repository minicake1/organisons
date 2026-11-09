//! Tests sur un vrai fichier : BRM 600 « Tour de Manche 2027 » (Openrunner).

use std::path::PathBuf;

use traces_core::scan::scan_library;
use traces_core::*;

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/brm600-tour-de-manche.gpx")
}

#[test]
fn analyse_du_brm600() {
    let a = analyze_file(&fixture()).expect("analyse");
    assert!(a.name.starts_with("BRM 600"), "{}", a.name);
    assert!((a.distance_km - 605.0).abs() < 1.0, "distance {}", a.distance_km);
    // Même méthode que la maquette : ~3 934 m.
    assert!((a.elevation_gain - 3934.0).abs() < 60.0, "D+ {}", a.elevation_gain);
    assert!(a.ele_max > 340.0 && a.ele_max < 380.0, "max {}", a.ele_max);
    assert_eq!(a.hilliness, Hilliness::Flat); // 6,5 m/km
    assert_eq!(a.point_count, 14322);
    assert!(a.has_time);
    assert_eq!(a.pois.len(), 182);
    let count = |k: PoiKind| a.pois.iter().filter(|p| p.kind == k).count();
    assert_eq!(count(PoiKind::Control), 8);
    assert_eq!(count(PoiKind::Warning), 5);
    assert_eq!(count(PoiKind::Water), 34);
    assert_eq!(count(PoiKind::Shop), 40);
    assert_eq!(count(PoiKind::Sight), 95);
    // Profil borné à 2000 points, kilomètres croissants.
    assert_eq!(a.profile.len(), 2001);
    assert!(a.profile.windows(2).all(|w| w[0].km <= w[1].km));
    // Les POI sont triés par km.
    assert!(a.pois.windows(2).all(|w| w[0].km <= w[1].km));
}

#[test]
fn indexation_et_filtres() {
    let dir = tempfile::tempdir().unwrap();
    let sub = dir.path().join("Velo-route/2027");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::copy(fixture(), sub.join("brm600.gpx")).unwrap();
    std::fs::copy(fixture(), dir.path().join("copie.GPX")).unwrap();
    std::fs::write(dir.path().join("notes.txt"), "pas un gpx").unwrap();

    let mut idx = Index::open_in_memory().unwrap();
    let lib = idx.add_library("Test", &dir.path().to_string_lossy(), "index", "").unwrap();

    let r = scan_library(&mut idx, &lib, 1_000).unwrap();
    assert_eq!((r.added, r.updated, r.unchanged, r.removed), (2, 0, 0, 0), "{r:?}");
    assert!(r.errors.is_empty(), "{:?}", r.errors);

    // Second passage : rien ne change.
    let r = scan_library(&mut idx, &lib, 2_000).unwrap();
    assert_eq!((r.added, r.unchanged), (0, 2));

    // Doublons : les deux fichiers sont identiques.
    let d = idx.duplicates().unwrap();
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].paths.len(), 2);

    // Filtres.
    let all = idx.list(&TraceFilter::default()).unwrap();
    assert_eq!(all.len(), 2);
    let id = all[0].id;
    idx.set_tags(id, &["Brevet".into(), "Favori".into()]).unwrap();
    let f = |f: TraceFilter| idx.list(&f).unwrap().len();
    assert_eq!(f(TraceFilter { distance_min: Some(500.0), ..Default::default() }), 2);
    assert_eq!(f(TraceFilter { distance_max: Some(100.0), ..Default::default() }), 0);
    assert_eq!(f(TraceFilter { hilliness: Some(Hilliness::Flat), ..Default::default() }), 2);
    assert_eq!(f(TraceFilter { hilliness: Some(Hilliness::Hilly), ..Default::default() }), 0);
    assert_eq!(f(TraceFilter { tag: Some("Brevet".into()), ..Default::default() }), 1);
    assert_eq!(f(TraceFilter { query: Some("favori".into()), ..Default::default() }), 1);
    assert_eq!(f(TraceFilter { query: Some("manche".into()), ..Default::default() }), 2);

    let wind = all[0].wind;
    assert_eq!(f(TraceFilter { wind: Some(wind), ..Default::default() }), 2);
    let opposite = WindDirection::ALL.into_iter().find(|w| w.diff(wind) == 180.0).unwrap();
    assert_eq!(f(TraceFilter { wind: Some(opposite), wind_near: true, ..Default::default() }), 0);

    // Fiche complète.
    let detail = idx.get(id).unwrap();
    assert_eq!(detail.pois.len(), 182);
    assert_eq!(detail.summary.tags, vec!["Brevet".to_string(), "Favori".to_string()]);
    assert_eq!(detail.summary.preview.len(), 60);

    // Fichier supprimé → retiré de l'index.
    std::fs::remove_file(dir.path().join("copie.GPX")).unwrap();
    let r = scan_library(&mut idx, &lib, 3_000).unwrap();
    assert_eq!(r.removed, 1);
    assert_eq!(idx.count().unwrap(), 1);
}
