//! Couche Tauri : expose le cœur (`traces-core`) à l'interface React.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Manager, State};
use traces_core::scan::scan_library;
use traces_core::{DuplicateGroup, Index, Library, ScanReport, TraceDetail, TraceFilter, TraceSummary};

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
) -> CmdResult<ScanReport> {
    let mut index = state.index.lock().map_err(err)?;
    let lib = index
        .add_library(&name, &path, mode.as_deref().unwrap_or("index"), "{sport}/{annee}/{nom}.gpx")
        .map_err(err)?;
    scan_library(&mut index, &lib, now()).map_err(err)
}

#[tauri::command]
fn remove_library(state: State<AppState>, id: i64) -> CmdResult<()> {
    state.index.lock().map_err(err)?.remove_library(id).map_err(err)
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
        let r = scan_library(&mut index, &lib, now()).map_err(err)?;
        total.added += r.added;
        total.updated += r.updated;
        total.unchanged += r.unchanged;
        total.removed += r.removed;
        total.errors.extend(r.errors);
    }
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
    state.index.lock().map_err(err)?.set_tags(id, &tags).map_err(err)
}

#[tauri::command]
fn set_notes(state: State<AppState>, id: i64, notes: String) -> CmdResult<()> {
    state.index.lock().map_err(err)?.set_notes(id, &notes).map_err(err)
}

#[tauri::command]
fn set_surface_type(state: State<AppState>, id: i64, surface: Option<String>) -> CmdResult<()> {
    state.index.lock().map_err(err)?.set_surface_type(id, surface.as_deref()).map_err(err)
}

#[tauri::command]
fn all_tags(state: State<AppState>) -> CmdResult<Vec<String>> {
    state.index.lock().map_err(err)?.all_tags().map_err(err)
}

#[tauri::command]
fn duplicates(state: State<AppState>) -> CmdResult<Vec<DuplicateGroup>> {
    state.index.lock().map_err(err)?.duplicates().map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let index = Index::open(&dir.join("index.sqlite"))?;
            app.manage(AppState { index: Mutex::new(index) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_libraries,
            add_library,
            remove_library,
            scan_all,
            list_traces,
            get_trace,
            set_tags,
            set_notes,
            set_surface_type,
            all_tags,
            duplicates
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement d'Organisons");
}
