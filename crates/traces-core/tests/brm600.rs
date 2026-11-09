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
    let lib = idx.add_library("Test", &dir.path().to_string_lossy(), "index", "", false).unwrap();

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

#[test]
fn tags_ecrits_dans_le_gpx_openrunner() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("brm600.gpx");
    std::fs::copy(fixture(), &file).unwrap();

    let mut idx = Index::open_in_memory().unwrap();
    let lib = idx.add_library("NAS", &dir.path().to_string_lossy(), "managed", "", true).unwrap();
    scan_library(&mut idx, &lib, 1_000).unwrap();
    let id = idx.list(&TraceFilter::default()).unwrap()[0].id;

    idx.set_tags(id, &["Brevet".into(), "Manche & côte".into()]).unwrap();
    idx.set_notes(id, "Contrôle secret <à vérifier>").unwrap();
    assert!(scan::write_trace_meta(&idx, id).unwrap());

    // L'analyse du fichier modifié est identique (points, POI Openrunner…).
    let a = analyze_file(&file).unwrap();
    assert_eq!(a.point_count, 14322);
    assert_eq!(a.pois.len(), 182);
    // Le fichier n'est pas réanalysé : l'appli connaît déjà son nouvel état.
    let r = scan_library(&mut idx, &lib, 2_000).unwrap();
    assert_eq!((r.unchanged, r.updated), (1, 0), "{r:?}");

    // Index remis à zéro : les tags et notes reviennent depuis le GPX.
    let mut fresh = Index::open_in_memory().unwrap();
    let lib2 = fresh.add_library("NAS", &dir.path().to_string_lossy(), "managed", "", true).unwrap();
    scan_library(&mut fresh, &lib2, 3_000).unwrap();
    let t = fresh.get(fresh.list(&TraceFilter::default()).unwrap()[0].id).unwrap();
    assert_eq!(t.summary.tags, vec!["Brevet".to_string(), "Manche & côte".to_string()]);
    // Nouvelle trace dans cet index : l’identifiant Openrunner retiré du nom est ajouté aux notes.
    assert_eq!(t.notes, "Contrôle secret <à vérifier>
Openrunner : https://www.openrunner.com/route-details/24118757");
    assert_eq!(t.summary.name, "BRM 600 Tour de Manche");

    // Bibliothèque sans autorisation d'écriture : le fichier n'est pas touché.
    let before = std::fs::read(&file).unwrap();
    fresh.set_library_write_gpx(lib2.id, false).unwrap();
    fresh.set_tags(t.summary.id, &["Autre".into()]).unwrap();
    assert!(!scan::write_trace_meta(&fresh, t.summary.id).unwrap());
    assert_eq!(std::fs::read(&file).unwrap(), before);
}

#[test]
fn rangement_et_import() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("NAS");
    std::fs::create_dir_all(root.join("vrac/sous-dossier")).unwrap();
    std::fs::copy(fixture(), root.join("vrac/sous-dossier/a.gpx")).unwrap();
    std::fs::copy(fixture(), root.join("b.gpx")).unwrap();

    let mut idx = Index::open_in_memory().unwrap();
    let lib = idx
        .add_library("NAS", &root.to_string_lossy(), "managed", "{sport}/{annee}/{nom}.gpx", true)
        .unwrap();
    scan_library(&mut idx, &lib, 1_000).unwrap();

    // Aperçu : deux traces au même nom → la seconde est numérotée.
    let moves = organize::plan(&idx, &lib).unwrap();
    assert_eq!(moves.len(), 2, "{moves:?}");
    // Année lue dans le titre (« … 2027-24118757 »), nom nettoyé (sans « _ », date ni identifiant Openrunner).
    let base = root.join("Vélo").join("2027");
    let name = "BRM 600 Tour de Manche";
    assert!(moves.iter().all(|m| m.to.starts_with(&*base.to_string_lossy())), "{moves:?}");
    assert!(moves.iter().any(|m| m.to.ends_with(&format!("{name}.gpx"))), "{moves:?}");
    assert!(moves.iter().any(|m| m.to.ends_with(&format!("{name} (2).gpx"))), "{moves:?}");
    // Rien n'a bougé tant que l'aperçu n'est pas validé.
    assert!(root.join("b.gpx").exists());

    let r = organize::apply(&idx, &lib, &moves).unwrap();
    assert_eq!(r.moved, 2, "{:?}", r.errors);
    assert!(!root.join("vrac").exists(), "les dossiers vidés sont supprimés");
    // Relecture : les traces sont retrouvées à leur nouvelle place, rien d'ajouté ni retiré.
    let s = scan_library(&mut idx, &lib, 2_000).unwrap();
    assert_eq!((s.added, s.removed, s.unchanged), (0, 0, 2), "{s:?}");
    assert!(organize::plan(&idx, &lib).unwrap().is_empty(), "déjà rangé");

    // Import : copie directement à sa place, l'original reste.
    let outside = dir.path().join("Téléchargements");
    std::fs::create_dir_all(&outside).unwrap();
    let src = outside.join("nouveau.gpx");
    std::fs::copy(fixture(), &src).unwrap();
    let r = organize::import_files(&mut idx, &lib, &[src.to_string_lossy().to_string()], 3_000).unwrap();
    assert_eq!(r.imported, 1, "{:?}", r.errors);
    assert!(src.exists());
    assert!(base.join(format!("{name} (3).gpx")).exists());
    assert_eq!(idx.count().unwrap(), 3);
}

#[test]
fn collections_tags_et_doublons() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::copy(fixture(), root.join("a.gpx")).unwrap();
    std::fs::copy(fixture(), root.join("a-copie.gpx")).unwrap();
    // Même parcours, fichier différent (réexport) → doublon probable.
    let xml = std::fs::read_to_string(fixture()).unwrap().replacen("<gpx", "<!-- réexport -->\n<gpx", 1);
    std::fs::write(root.join("reexport.gpx"), xml).unwrap();

    let mut idx = Index::open_in_memory().unwrap();
    let lib = idx.add_library("PC", &root.to_string_lossy(), "index", "", true).unwrap();
    scan_library(&mut idx, &lib, 1_000).unwrap();
    let ids: Vec<i64> = idx.list(&TraceFilter::default()).unwrap().iter().map(|t| t.id).collect();
    assert_eq!(ids.len(), 3);

    // Les trois forment un seul groupe, « probable » car tous les fichiers ne sont pas identiques.
    let sets = idx.duplicate_sets().unwrap();
    assert_eq!(sets.len(), 1, "{sets:?}");
    assert_eq!(sets[0].kind, "probable");
    assert_eq!(sets[0].traces.len(), 3);

    // « Pas des doublons » : le réexport sort du groupe, il reste la copie exacte.
    let reexport = idx.trace_id_by_path(&root.join("reexport.gpx").to_string_lossy()).unwrap().unwrap();
    let a = idx.trace_id_by_path(&root.join("a.gpx").to_string_lossy()).unwrap().unwrap();
    let copie = idx.trace_id_by_path(&root.join("a-copie.gpx").to_string_lossy()).unwrap().unwrap();
    idx.mark_not_duplicates(&[reexport, a]).unwrap();
    idx.mark_not_duplicates(&[reexport, copie]).unwrap();
    let sets = idx.duplicate_sets().unwrap();
    assert_eq!(sets.len(), 1);
    assert_eq!(sets[0].kind, "identical");
    assert_eq!(sets[0].traces.len(), 2);

    // Mettre de côté : le fichier part dans le dossier caché, la relecture ne le reprend pas.
    let jour = 1_777_593_600; // 2026-05-01
    let moved = organize::set_aside(&idx, copie, jour).unwrap();
    assert!(moved.ends_with("2026-05-01 a-copie.gpx"), "{moved}");
    assert!(moved.contains(organize::SET_ASIDE_DIR));
    assert!(std::path::Path::new(&moved).exists());
    assert!(!root.join("a-copie.gpx").exists());
    let r = scan_library(&mut idx, &lib, 2_000).unwrap();
    assert_eq!((r.added, r.removed), (0, 0), "{r:?}");
    assert!(idx.duplicate_sets().unwrap().is_empty());

    // Vidage : rien avant 7 jours, puis le fichier part ; le dossier vide est supprimé.
    assert_eq!(organize::set_aside_info(&idx).unwrap().count, 1);
    assert_eq!(organize::purge_set_aside(&idx, jour + 6 * 86_400, Some(7)).unwrap(), 0);
    assert_eq!(organize::purge_set_aside(&idx, jour + 8 * 86_400, Some(7)).unwrap(), 1);
    assert!(!root.join(organize::SET_ASIDE_DIR).exists());
    assert_eq!(organize::set_aside_info(&idx).unwrap().count, 0);
    assert!(root.join("a.gpx").exists(), "les autres fichiers ne sont pas touchés");

    // Collections.
    let brm = idx.create_collection("BRM 2027", 1).unwrap();
    assert!(idx.create_collection("brm 2027", 2).is_err(), "nom en double");
    idx.set_trace_collections(a, &[brm.id]).unwrap();
    assert_eq!(idx.collections().unwrap()[0].count, 1);
    assert_eq!(idx.get(a).unwrap().collection_ids, vec![brm.id]);
    let in_brm = idx.list(&TraceFilter { collection: Some(brm.id), ..Default::default() }).unwrap();
    assert_eq!(in_brm.iter().map(|t| t.id).collect::<Vec<_>>(), vec![a]);
    idx.rename_collection(brm.id, "Brevets 2027").unwrap();
    idx.delete_collection(brm.id).unwrap();
    assert_eq!(idx.count().unwrap(), 2, "supprimer une collection ne supprime pas les traces");

    // Tags : renommer vers un tag existant fusionne, et réécrit les GPX.
    idx.set_tags(a, &["brevet".into(), "Brevet".into()]).unwrap();
    idx.set_tags(reexport, &["brevet".into()]).unwrap();
    let touched = idx.rename_tag("brevet", "Brevet").unwrap();
    assert_eq!(touched.len(), 2);
    for id in &touched {
        scan::write_trace_meta(&idx, *id).unwrap();
    }
    let counts = idx.tag_counts().unwrap();
    assert_eq!(counts.len(), 1);
    assert_eq!((counts[0].tag.as_str(), counts[0].count), ("Brevet", 2));
    assert_eq!(gpxmeta::read_meta_file(&root.join("a.gpx")).unwrap().tags, vec!["Brevet"]);
    let touched = idx.delete_tag("Brevet").unwrap();
    assert_eq!(touched.len(), 2);
    assert!(idx.tag_counts().unwrap().is_empty());
}
