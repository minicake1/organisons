//! Couche Tauri : expose le cœur (`traces-core`) à l'interface React.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Manager, State};
use traces_core::scan::{scan_library, write_trace_meta};
use traces_core::{
    organize, sport, surface, Collection, DuplicateGroup, DuplicateSet, Index, Library, OrganizeReport, PlannedMove,
    ScanReport, SetAsideInfo, TagCount, TraceDetail, TraceFilter, TraceSummary,
};

struct AppState {
    index: Mutex<Index>,
}

type CmdResult<T> = Result<T, String>;

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Après une modification des tags ou des notes : écrit aussi dans le GPX si
/// la bibliothèque l'autorise. L'index est déjà à jour même si l'écriture échoue.
fn sync_gpx(index: &Index, id: i64) -> CmdResult<()> {
    write_trace_meta(index, id)
        .map(|_| ())
        .map_err(|e| format!("Enregistré dans l'appli, mais pas dans le fichier GPX : {e}"))
}

#[tauri::command]
fn list_libraries(state: State<AppState>) -> CmdResult<Vec<Library>> {
    state.index.lock().map_err(err)?.libraries().map_err(err)
}

/// Ajoute un dossier (local ou partage NAS) puis l'indexe.
#[tauri::command]
async fn add_library(
    state: State<'_, AppState>,
    name: String,
    path: String,
    mode: Option<String>,
    write_gpx: Option<bool>,
) -> CmdResult<ScanReport> {
    let mut index = state.index.lock().map_err(err)?;
    let mode = mode.as_deref().unwrap_or("index");
    let write_gpx = write_gpx.unwrap_or(mode == "managed");
    let lib = index.add_library(&name, &path, mode, "{sport}/{annee}/{nom}.gpx", write_gpx).map_err(err)?;
    scan_library(&mut index, &lib, now()).map_err(err)
}

#[tauri::command]
fn remove_library(state: State<AppState>, id: i64) -> CmdResult<()> {
    state.index.lock().map_err(err)?.remove_library(id).map_err(err)
}

#[tauri::command]
fn set_library_write_gpx(state: State<AppState>, id: i64, write_gpx: bool) -> CmdResult<()> {
    state.index.lock().map_err(err)?.set_library_write_gpx(id, write_gpx).map_err(err)
}

/// Relit toutes les bibliothèques (seuls les fichiers modifiés sont réanalysés).
#[tauri::command]
async fn scan_all(state: State<'_, AppState>) -> CmdResult<ScanReport> {
    let mut index = state.index.lock().map_err(err)?;
    let mut total = ScanReport::default();
    for lib in index.libraries().map_err(err)? {
        if !std::path::Path::new(&lib.path).exists() {
            total.errors.push(format!("{} : dossier injoignable ({})", lib.name, lib.path));
            continue;
        }
        let r = match scan_library(&mut index, &lib, now()) {
            Ok(r) => r,
            Err(e) => {
                total.errors.push(e.to_string());
                continue;
            }
        };
        total.added += r.added;
        total.updated += r.updated;
        total.unchanged += r.unchanged;
        total.removed += r.removed;
        total.errors.extend(r.errors);
    }
    auto_purge(&index);
    Ok(total)
}

#[tauri::command]
fn list_traces(state: State<AppState>, filter: TraceFilter) -> CmdResult<Vec<TraceSummary>> {
    state.index.lock().map_err(err)?.list(&filter).map_err(err)
}

#[tauri::command]
fn get_trace(state: State<AppState>, id: i64) -> CmdResult<TraceDetail> {
    state.index.lock().map_err(err)?.get(id).map_err(err)
}

#[tauri::command]
fn set_tags(state: State<AppState>, id: i64, tags: Vec<String>) -> CmdResult<()> {
    let mut index = state.index.lock().map_err(err)?;
    index.set_tags(id, &tags).map_err(err)?;
    sync_gpx(&index, id)
}

#[tauri::command]
fn set_notes(state: State<AppState>, id: i64, notes: String) -> CmdResult<()> {
    let index = state.index.lock().map_err(err)?;
    index.set_notes(id, &notes).map_err(err)?;
    sync_gpx(&index, id)
}

#[tauri::command]
fn set_surface_type(state: State<AppState>, id: i64, surface: Option<String>) -> CmdResult<()> {
    state.index.lock().map_err(err)?.set_surface_type(id, surface.as_deref()).map_err(err)
}

/// Change le modèle de rangement d’une bibliothèque gérée (vérifié avant).
#[tauri::command]
fn set_library_pattern(state: State<AppState>, id: i64, pattern: String) -> CmdResult<()> {
    organize::validate_pattern(&pattern).map_err(err)?;
    state.index.lock().map_err(err)?.set_library_pattern(id, pattern.trim()).map_err(err)
}

/// Exemple de chemin pour un modèle de rangement (ou l’erreur qui l’empêche).
#[tauri::command]
fn preview_pattern(pattern: String) -> CmdResult<String> {
    organize::pattern_example(&pattern).map_err(err)
}

/// Bibliothèques injoignables (NAS éteint…) : consultables, mais sans action sur les fichiers.
/// Vérifiées en parallèle et hors du fil principal : un partage réseau absent peut mettre
/// plusieurs secondes à répondre.
#[tauri::command]
async fn offline_libraries(state: State<'_, AppState>) -> CmdResult<Vec<i64>> {
    let libs = state.index.lock().map_err(err)?.libraries().map_err(err)?;
    let checks = libs.into_iter().map(|l| {
        tauri::async_runtime::spawn_blocking(move || (l.id, std::path::Path::new(&l.path).is_dir()))
    });
    let mut offline = Vec::new();
    for c in checks.collect::<Vec<_>>() {
        let (id, ok) = c.await.map_err(err)?;
        if !ok {
            offline.push(id);
        }
    }
    Ok(offline)
}

/// Compare des fichiers à importer avec la bibliothèque (rien n’est copié).
#[tauri::command]
fn check_import(state: State<AppState>, files: Vec<String>) -> CmdResult<Vec<traces_core::ImportCheck>> {
    organize::check_import(&*state.index.lock().map_err(err)?, &files).map_err(err)
}

/// Active ou non la détection automatique d’un tag dans les titres et métadonnées.
#[tauri::command]
fn set_tag_auto(state: State<AppState>, tag: String, auto: bool) -> CmdResult<()> {
    state.index.lock().map_err(err)?.set_tag_auto(&tag, auto).map_err(err)
}

/// Mots-clés de détection d’un tag (en plus de son nom).
#[tauri::command]
fn set_tag_keywords(state: State<AppState>, tag: String, keywords: Vec<String>) -> CmdResult<()> {
    state.index.lock().map_err(err)?.set_tag_keywords(&tag, &keywords).map_err(err)
}

/// Modifie plusieurs traces (tags, sport, collections). Renvoie les erreurs
/// d’écriture dans les GPX (l’index, lui, est à jour).
#[tauri::command]
fn batch_edit(state: State<AppState>, ids: Vec<i64>, edit: traces_core::BatchEdit) -> CmdResult<Vec<String>> {
    let mut index = state.index.lock().map_err(err)?;
    let changed = index.batch_edit(&ids, &edit, now()).map_err(err)?;
    Ok(changed.into_iter().filter_map(|id| sync_gpx(&index, id).err()).collect())
}

/// Crée un tag sans trace (onglet Tags).
#[tauri::command]
fn create_tag(state: State<AppState>, name: String) -> CmdResult<()> {
    state.index.lock().map_err(err)?.create_tag(&name).map_err(err)
}

/// Écarte des tags proposés pour une trace.
#[tauri::command]
fn ignore_tag_suggestions(state: State<AppState>, id: i64, tags: Vec<String>) -> CmdResult<()> {
    state.index.lock().map_err(err)?.ignore_tag_suggestions(id, &tags).map_err(err)
}

/// Associe la trace aux voies lues dans les tuiles OSM et enregistre le revêtement.
#[tauri::command]
fn set_surface(state: State<AppState>, id: i64, ways: Vec<surface::OsmWay>) -> CmdResult<Vec<surface::SurfaceRun>> {
    let index = state.index.lock().map_err(err)?;
    let runs = surface::match_surface(&index.profile(id).map_err(err)?, &ways);
    index.set_surface(id, &runs, now()).map_err(err)?;
    Ok(runs)
}

#[tauri::command]
fn set_sport(state: State<AppState>, id: i64, sport: Option<String>) -> CmdResult<()> {
    state.index.lock().map_err(err)?.set_sport(id, sport.as_deref()).map_err(err)
}

#[tauri::command]
fn sports() -> Vec<&'static str> {
    sport::SPORTS.to_vec()
}

#[tauri::command]
fn all_tags(state: State<AppState>) -> CmdResult<Vec<String>> {
    state.index.lock().map_err(err)?.all_tags().map_err(err)
}

#[tauri::command]
fn duplicates(state: State<AppState>) -> CmdResult<Vec<DuplicateGroup>> {
    state.index.lock().map_err(err)?.duplicates().map_err(err)
}

/// Aperçu du rangement : aucun fichier n'est déplacé.
#[tauri::command]
fn plan_organize(state: State<AppState>, library_id: i64) -> CmdResult<Vec<PlannedMove>> {
    let index = state.index.lock().map_err(err)?;
    let lib = index.library(library_id).map_err(err)?;
    if lib.mode != "managed" {
        return Err("seules les bibliothèques gérées sont rangées".into());
    }
    organize::plan(&index, &lib).map_err(err)
}

/// Déplace les fichiers validés dans l'aperçu.
#[tauri::command]
async fn apply_organize(
    state: State<'_, AppState>,
    library_id: i64,
    moves: Vec<PlannedMove>,
) -> CmdResult<OrganizeReport> {
    let index = state.index.lock().map_err(err)?;
    let lib = index.library(library_id).map_err(err)?;
    if lib.mode != "managed" {
        return Err("seules les bibliothèques gérées sont rangées".into());
    }
    organize::apply(&index, &lib, &moves).map_err(err)
}

/// Copie des GPX dans une bibliothèque gérée, directement à leur place.
#[tauri::command]
async fn import_files(state: State<'_, AppState>, library_id: i64, files: Vec<String>) -> CmdResult<OrganizeReport> {
    let mut index = state.index.lock().map_err(err)?;
    let lib = index.library(library_id).map_err(err)?;
    if lib.mode != "managed" {
        return Err("l'import se fait dans une bibliothèque gérée".into());
    }
    organize::import_files(&mut index, &lib, &files, now()).map_err(err)
}

// ---- Collections ---------------------------------------------------------

#[tauri::command]
fn collections(state: State<AppState>) -> CmdResult<Vec<Collection>> {
    state.index.lock().map_err(err)?.collections().map_err(err)
}

#[tauri::command]
fn create_collection(state: State<AppState>, name: String) -> CmdResult<Collection> {
    state.index.lock().map_err(err)?.create_collection(&name, now()).map_err(err)
}

#[tauri::command]
fn rename_collection(state: State<AppState>, id: i64, name: String) -> CmdResult<()> {
    state.index.lock().map_err(err)?.rename_collection(id, &name).map_err(err)
}

#[tauri::command]
fn delete_collection(state: State<AppState>, id: i64) -> CmdResult<()> {
    state.index.lock().map_err(err)?.delete_collection(id).map_err(err)
}

#[tauri::command]
fn set_trace_collections(state: State<AppState>, id: i64, collection_ids: Vec<i64>) -> CmdResult<()> {
    state.index.lock().map_err(err)?.set_trace_collections(id, &collection_ids).map_err(err)
}

// ---- Tags ----------------------------------------------------------------

#[tauri::command]
fn tag_counts(state: State<AppState>) -> CmdResult<Vec<TagCount>> {
    state.index.lock().map_err(err)?.tag_counts().map_err(err)
}

/// Réécrit le GPX de chaque trace touchée ; renvoie les erreurs d'écriture
/// (l'index, lui, est déjà à jour).
fn sync_many(index: &Index, ids: &[i64]) -> Vec<String> {
    ids.iter().filter_map(|id| write_trace_meta(index, *id).err().map(|e| e.to_string())).collect()
}

#[tauri::command]
fn rename_tag(state: State<AppState>, old: String, new: String) -> CmdResult<Vec<String>> {
    let mut index = state.index.lock().map_err(err)?;
    let ids = index.rename_tag(&old, &new).map_err(err)?;
    Ok(sync_many(&index, &ids))
}

#[tauri::command]
fn delete_tag(state: State<AppState>, tag: String) -> CmdResult<Vec<String>> {
    let index = state.index.lock().map_err(err)?;
    let ids = index.delete_tag(&tag).map_err(err)?;
    Ok(sync_many(&index, &ids))
}

// ---- Doublons ------------------------------------------------------------

#[tauri::command]
fn duplicate_sets(state: State<AppState>) -> CmdResult<Vec<DuplicateSet>> {
    state.index.lock().map_err(err)?.duplicate_sets().map_err(err)
}

#[tauri::command]
fn mark_not_duplicates(state: State<AppState>, ids: Vec<i64>) -> CmdResult<()> {
    state.index.lock().map_err(err)?.mark_not_duplicates(&ids).map_err(err)
}

/// Déplace le fichier dans `.organisons-doublons` (rien n'est supprimé).
#[tauri::command]
fn set_aside_duplicate(state: State<AppState>, id: i64) -> CmdResult<String> {
    let index = state.index.lock().map_err(err)?;
    organize::set_aside(&index, id, now()).map_err(err)
}

const PURGE_DAYS_KEY: &str = "set_aside_purge_days";
const TRASH_PURGE_DAYS_KEY: &str = "trash_purge_days";

fn setting_days(index: &Index, key: &str) -> u32 {
    index.setting(key).ok().flatten().and_then(|v| v.parse().ok()).unwrap_or(0)
}

/// Met une trace à la corbeille d’Organisons (son GPX reste récupérable jusqu’au vidage).
#[tauri::command]
fn trash_trace(state: State<AppState>, id: i64) -> CmdResult<String> {
    let index = state.index.lock().map_err(err)?;
    organize::trash_trace(&index, id, now()).map_err(err)
}

#[tauri::command]
fn trash_info(state: State<AppState>) -> CmdResult<SetAsideInfo> {
    organize::trash_info(&*state.index.lock().map_err(err)?).map_err(err)
}

/// Contenu de la corbeille, le plus récent d’abord.
#[tauri::command]
fn trash_list(state: State<AppState>) -> CmdResult<Vec<traces_core::TrashItem>> {
    organize::trash_list(&*state.index.lock().map_err(err)?).map_err(err)
}

/// Remet une trace de la corbeille dans sa bibliothèque ; renvoie son identifiant.
#[tauri::command]
fn restore_trash(state: State<AppState>, path: String) -> CmdResult<i64> {
    let mut index = state.index.lock().map_err(err)?;
    organize::restore_from_trash(&mut index, &path, now()).map_err(err)
}

/// Vide définitivement la corbeille (tout si `older_than_days` est absent).
#[tauri::command]
fn purge_trash(state: State<AppState>, older_than_days: Option<u32>) -> CmdResult<usize> {
    organize::purge_trash(&*state.index.lock().map_err(err)?, now(), older_than_days).map_err(err)
}

#[tauri::command]
fn get_trash_purge_days(state: State<AppState>) -> CmdResult<u32> {
    Ok(setting_days(&*state.index.lock().map_err(err)?, TRASH_PURGE_DAYS_KEY))
}

#[tauri::command]
fn set_trash_purge_days(state: State<AppState>, days: u32) -> CmdResult<()> {
    let index = state.index.lock().map_err(err)?;
    index.set_setting(TRASH_PURGE_DAYS_KEY, &days.to_string()).map_err(err)?;
    auto_purge(&index);
    Ok(())
}

/// Délai de suppression automatique des doublons mis de côté (0 = jamais).
fn purge_days(index: &Index) -> u32 {
    index.setting(PURGE_DAYS_KEY).ok().flatten().and_then(|v| v.parse().ok()).unwrap_or(0)
}

/// Vidage automatique selon le délai choisi (silencieux si rien à faire).
fn auto_purge(index: &Index) {
    let days = purge_days(index);
    if days > 0 {
        let _ = organize::purge_set_aside(index, now(), Some(days));
    }
    let trash_days = setting_days(index, TRASH_PURGE_DAYS_KEY);
    if trash_days > 0 {
        let _ = organize::purge_trash(index, now(), Some(trash_days));
    }
}

#[tauri::command]
fn set_aside_info(state: State<AppState>) -> CmdResult<SetAsideInfo> {
    organize::set_aside_info(&*state.index.lock().map_err(err)?).map_err(err)
}

/// Supprime définitivement les doublons mis de côté (tous si `older_than_days` est absent).
#[tauri::command]
fn purge_set_aside(state: State<AppState>, older_than_days: Option<u32>) -> CmdResult<usize> {
    organize::purge_set_aside(&*state.index.lock().map_err(err)?, now(), older_than_days).map_err(err)
}

#[tauri::command]
fn get_purge_days(state: State<AppState>) -> CmdResult<u32> {
    Ok(purge_days(&*state.index.lock().map_err(err)?))
}

#[tauri::command]
fn set_purge_days(state: State<AppState>, days: u32) -> CmdResult<()> {
    let index = state.index.lock().map_err(err)?;
    index.set_setting(PURGE_DAYS_KEY, &days.to_string()).map_err(err)?;
    auto_purge(&index);
    Ok(())
}

/// Index de la bibliothèque. La version de développement (`npm run tauri dev`) a
/// le sien, `index-dev.sqlite`, pour ne pas toucher aux données de la version
/// installée ; au premier lancement, elle part d’une copie de l’index installé.
fn index_path(dir: &std::path::Path) -> std::path::PathBuf {
    let main = dir.join("index.sqlite");
    if !cfg!(debug_assertions) {
        return main;
    }
    let dev = dir.join("index-dev.sqlite");
    if !dev.exists() && main.exists() {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::copy(&main, &dev);
    }
    dev
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let index = Index::open(&index_path(&dir))?;
            auto_purge(&index);
            app.manage(AppState { index: Mutex::new(index) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_libraries,
            add_library,
            remove_library,
            set_library_write_gpx,
            scan_all,
            list_traces,
            get_trace,
            set_tags,
            set_notes,
            set_surface_type,
            set_sport,
            set_surface,
            ignore_tag_suggestions,
            set_library_pattern,
            preview_pattern,
            check_import,
            offline_libraries,
            create_tag,
            batch_edit,
            set_tag_auto,
            set_tag_keywords,
            trash_trace,
            trash_info,
            purge_trash,
            trash_list,
            restore_trash,
            get_trash_purge_days,
            set_trash_purge_days,
            sports,
            all_tags,
            duplicates,
            plan_organize,
            apply_organize,
            import_files,
            collections,
            create_collection,
            rename_collection,
            delete_collection,
            set_trace_collections,
            tag_counts,
            rename_tag,
            delete_tag,
            duplicate_sets,
            mark_not_duplicates,
            set_aside_duplicate,
            set_aside_info,
            purge_set_aside,
            get_purge_days,
            set_purge_days
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement d'Organisons");
}
