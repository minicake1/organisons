//! Couche Tauri : expose le cœur (`traces-core`) à l'interface React.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager, State};

mod hammerhead;
mod http;
mod komoot;
mod openrunner;
mod training;
use traces_core::scan::{scan_library_shared, write_trace_meta};
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
    app: tauri::AppHandle,
    name: String,
    path: String,
    mode: Option<String>,
    write_gpx: Option<bool>,
) -> CmdResult<ScanReport> {
    let mode = mode.as_deref().unwrap_or("index").to_string();
    let write_gpx = write_gpx.unwrap_or(mode == "managed");
    let lib = app
        .state::<AppState>()
        .index
        .lock()
        .map_err(err)?
        .add_library(&name, &path, &mode, "{sport}/{annee}/{nom}.gpx", write_gpx)
        .map_err(err)?;
    blocking(move || scan_library_shared(&app.state::<AppState>().index, &lib, now()).map_err(err)).await
}

/// Exécute un travail long (fichiers, NAS, réseau) hors du fil principal, pour
/// que la fenêtre ne se fige pas.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?
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
async fn scan_all(app: tauri::AppHandle) -> CmdResult<ScanReport> {
    blocking(move || scan_all_blocking(&app.state::<AppState>().index)).await
}

/// Relecture : l'index n'est verrouillé que fichier par fichier.
fn scan_all_blocking(index: &Mutex<Index>) -> CmdResult<ScanReport> {
    let libraries = index.lock().map_err(err)?.libraries().map_err(err)?;
    let mut total = ScanReport::default();
    for lib in libraries {
        if !std::path::Path::new(&lib.path).exists() {
            total.errors.push(format!("{} : dossier injoignable ({})", lib.name, lib.path));
            continue;
        }
        let r = match scan_library_shared(index, &lib, now()) {
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
    auto_purge(&*index.lock().map_err(err)?);
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

/// Tags et notes : le GPX est réécrit (parfois sur le NAS), donc hors du fil principal.
#[tauri::command]
async fn set_tags(app: tauri::AppHandle, id: i64, tags: Vec<String>) -> CmdResult<()> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut index = state.index.lock().map_err(err)?;
        index.set_tags(id, &tags).map_err(err)?;
        sync_gpx(&index, id)
    })
    .await
}

#[tauri::command]
async fn set_notes(app: tauri::AppHandle, id: i64, notes: String) -> CmdResult<()> {
    blocking(move || {
        let state = app.state::<AppState>();
        let index = state.index.lock().map_err(err)?;
        index.set_notes(id, &notes).map_err(err)?;
        sync_gpx(&index, id)
    })
    .await
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
async fn batch_edit(app: tauri::AppHandle, ids: Vec<i64>, edit: traces_core::BatchEdit) -> CmdResult<Vec<String>> {
    blocking(move || {
        let state = app.state::<AppState>();
        let changed = state.index.lock().map_err(err)?.batch_edit(&ids, &edit, now()).map_err(err)?;
        // Un fichier à la fois : l'interface peut lire l'index entre deux écritures.
        Ok(changed.into_iter().filter_map(|id| state.index.lock().map_err(err).and_then(|i| sync_gpx(&i, id)).err()).collect())
    })
    .await
}

/// Compte Komoot connecté (sans le jeton), ou rien.
#[tauri::command]
fn komoot_status() -> Option<komoot::AccountInfo> {
    komoot::load().as_ref().map(Into::into)
}

/// Connexion à Komoot : le mot de passe n’est utilisé qu’une fois, pour obtenir un jeton.
#[tauri::command]
async fn komoot_login(email: String, password: String) -> CmdResult<komoot::AccountInfo> {
    let account = tauri::async_runtime::spawn_blocking(move || komoot::login(&email, &password)).await.map_err(err)??;
    Ok((&account).into())
}

#[tauri::command]
fn komoot_logout() -> CmdResult<()> {
    komoot::logout()
}

/// Avancement envoyé à l’interface pendant une opération Komoot.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct KomootProgress {
    /// "list" (lecture de la liste) ou "import"
    phase: &'static str,
    done: usize,
    total: usize,
}

/// Parcours du compte Komoot, avec ceux déjà importés.
#[tauri::command]
async fn komoot_tours(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<Vec<komoot::Tour>> {
    let account = komoot::load().ok_or("Pas connecté à Komoot.")?;
    let mut tours = tauri::async_runtime::spawn_blocking(move || {
        komoot::tours(&account, |done| {
            let _ = app.emit("komoot-progress", KomootProgress { phase: "list", done, total: 0 });
        })
    })
    .await
    .map_err(err)??;
    let done = state.index.lock().map_err(err)?.external_imports("komoot").map_err(err)?;
    for t in &mut tours {
        t.imported = done.contains(&t.id);
    }
    Ok(tours)
}

/// Télécharge des parcours Komoot et les importe un par un dans une bibliothèque
/// gérée, en envoyant l’avancement. L’index n’est verrouillé que le temps
/// d’importer chaque parcours : le reste de l’appli reste utilisable.
#[tauri::command]
async fn komoot_import(app: tauri::AppHandle, library_id: i64, ids: Vec<String>) -> CmdResult<OrganizeReport> {
    let account = komoot::load().ok_or("Pas connecté à Komoot.")?;
    let dir = app.path().app_cache_dir().map_err(err)?.join("komoot");
    std::fs::create_dir_all(&dir).map_err(err)?;
    tauri::async_runtime::spawn_blocking(move || -> CmdResult<OrganizeReport> {
        let (lib, mut existing) = {
            let state = app.state::<AppState>();
            let index = state.index.lock().map_err(err)?;
            (index.library(library_id).map_err(err)?, index.list(&TraceFilter::default()).map_err(err)?)
        };
        let total = ids.len();
        let mut report = OrganizeReport::default();
        let _ = app.emit("komoot-progress", KomootProgress { phase: "import", done: 0, total });
        for (n, id) in ids.iter().enumerate() {
            let path = dir.join(format!("{id}.gpx"));
            match komoot::download(&account, id, &path) {
                Err(e) => report.errors.push(format!("Parcours Komoot {id} : {e}")),
                Ok(()) => {
                    let state = app.state::<AppState>();
                    let mut index = state.index.lock().map_err(err)?;
                    import_one(&mut index, &lib, &path, "komoot", id, &mut existing, &mut report)?;
                }
            }
            let _ = app.emit("komoot-progress", KomootProgress { phase: "import", done: n + 1, total });
        }
        Ok(report)
    })
    .await
    .map_err(err)?
}

/// Importe un GPX téléchargé (Komoot, Openrunner) dans la bibliothèque, sauf s'il
/// y est déjà : même fichier, ou même parcours (critères des Doublons), par
/// exemple exporté à la main auparavant. Dans ce cas il est ignoré et noté comme
/// importé, pour ne plus être proposé. Le fichier téléchargé est ensuite supprimé.
fn import_one(
    index: &mut Index,
    lib: &Library,
    path: &std::path::Path,
    source: &str,
    external_id: &str,
    existing: &mut Vec<TraceSummary>,
    report: &mut OrganizeReport,
) -> CmdResult<()> {
    let file = path.to_string_lossy().to_string();
    let check = organize::check_import_against(index, std::slice::from_ref(&file), existing).map_err(err)?.into_iter().next();
    match check {
        Some(c) if c.status == "identical" || c.status == "probable" => {
            report.skipped.push(format!("{} : déjà présent ({})", c.name, c.matches.join(", ")));
            index.mark_external_import(source, external_id, "", now()).map_err(err)?;
        }
        _ => {
            let one = organize::import_files(index, lib, &[file], now()).map_err(err)?;
            if let Some(&trace) = one.imported_ids.first() {
                let saved = index.get(trace).map_err(err)?.summary;
                index.mark_external_import(source, external_id, &saved.path, now()).map_err(err)?;
                // Un même parcours deux fois dans le lot : le second est reconnu.
                existing.push(saved);
            }
            report.imported += one.imported;
            report.imported_ids.extend(one.imported_ids);
            report.errors.extend(one.errors);
        }
    }
    let _ = std::fs::remove_file(path);
    Ok(())
}

/// Importe des parcours Openrunner à partir de leurs liens (parcours publics),
/// un par un, avec l’avancement (« openrunner-progress »).
#[tauri::command]
async fn openrunner_import(app: tauri::AppHandle, library_id: i64, links: Vec<String>) -> CmdResult<OrganizeReport> {
    let dir = app.path().app_cache_dir().map_err(err)?.join("openrunner");
    std::fs::create_dir_all(&dir).map_err(err)?;
    tauri::async_runtime::spawn_blocking(move || -> CmdResult<OrganizeReport> {
        let (lib, done, mut existing) = {
            let state = app.state::<AppState>();
            let index = state.index.lock().map_err(err)?;
            (
                index.library(library_id).map_err(err)?,
                index.external_imports("openrunner").map_err(err)?,
                index.list(&TraceFilter::default()).map_err(err)?,
            )
        };
        let links: Vec<&String> = links.iter().filter(|l| !l.trim().is_empty()).collect();
        let total = links.len();
        let mut report = OrganizeReport::default();
        for (n, link) in links.iter().enumerate() {
            let _ = app.emit("openrunner-progress", KomootProgress { phase: "import", done: n, total });
            let Some(id) = openrunner::route_id(link) else {
                report.errors.push(format!("{} : ce n’est pas un lien de parcours Openrunner", link.trim()));
                continue;
            };
            if done.contains(&id) {
                report.errors.push(format!("Parcours {id} : déjà importé"));
                continue;
            }
            let path = dir.join(format!("{id}.gpx"));
            if let Err(e) = openrunner::download(&id, &path) {
                report.errors.push(format!("Parcours {id} : {e}"));
                continue;
            }
            let state = app.state::<AppState>();
            let mut index = state.index.lock().map_err(err)?;
            import_one(&mut index, &lib, &path, "openrunner", &id, &mut existing, &mut report)?;
        }
        let _ = app.emit("openrunner-progress", KomootProgress { phase: "import", done: total, total });
        Ok(report)
    })
    .await
    .map_err(err)?
}

// ---- Entraînements (.zwo) --------------------------------------------------

#[tauri::command]
fn list_workouts(state: State<AppState>) -> CmdResult<Vec<traces_core::WorkoutSummary>> {
    state.index.lock().map_err(err)?.workouts().map_err(err)
}

/// Copie des séances .zwo dans le dossier « Entraînements » d’une bibliothèque.
#[tauri::command]
fn import_workouts(state: State<AppState>, library_id: i64, files: Vec<String>) -> CmdResult<OrganizeReport> {
    let index = state.index.lock().map_err(err)?;
    let lib = index.library(library_id).map_err(err)?;
    organize::import_workouts(&index, &lib, &files, now()).map_err(err)
}

/// Dossiers de séances Zwift trouvés sur ce PC (un par identifiant Zwift).
#[tauri::command]
fn zwift_folders(app: tauri::AppHandle) -> Vec<String> {
    let documents = app.path().document_dir().unwrap_or_default();
    training::zwift_folders(&documents)
}

/// Copie des séances dans le dossier Zwift choisi ; renvoie les erreurs.
#[tauri::command]
fn zwift_send(state: State<AppState>, ids: Vec<i64>, folder: String) -> CmdResult<Vec<String>> {
    let index = state.index.lock().map_err(err)?;
    let mut errors = Vec::new();
    for id in ids {
        let w = index.workout(id).map_err(err)?;
        if let Err(e) = training::send_to_zwift(&folder, &w.workout.name, std::path::Path::new(&w.path)) {
            errors.push(e);
        }
    }
    Ok(errors)
}

#[tauri::command]
fn icu_status() -> training::IcuStatus {
    training::icu_status()
}

#[tauri::command]
async fn icu_connect(athlete_id: String, api_key: String) -> CmdResult<training::IcuStatus> {
    tauri::async_runtime::spawn_blocking(move || training::icu_connect(&athlete_id, &api_key)).await.map_err(err)?
}

#[tauri::command]
fn icu_disconnect() -> CmdResult<()> {
    training::icu_disconnect()
}

/// Pose des séances au calendrier intervals.icu, à la date donnée (AAAA-MM-JJ).
#[tauri::command]
async fn icu_plan(app: tauri::AppHandle, ids: Vec<i64>, date: String) -> CmdResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || -> CmdResult<Vec<String>> {
        let mut errors = Vec::new();
        for id in ids {
            let w = app.state::<AppState>().index.lock().map_err(err)?.workout(id).map_err(err)?;
            let result = std::fs::read_to_string(&w.path)
                .map_err(|e| format!("{} : {e}", w.path))
                .and_then(|zwo| training::icu_plan(&w.workout.name, &zwo, &date, &w.workout.sport));
            if let Err(e) = result {
                errors.push(format!("{} : {e}", w.workout.name));
            }
        }
        Ok(errors)
    })
    .await
    .map_err(err)?
}

/// Entraînements déjà envoyés vers Hammerhead.
#[tauri::command]
fn workouts_sent(state: State<AppState>) -> CmdResult<Vec<i64>> {
    state.index.lock().map_err(err)?.workouts_sent("hammerhead").map_err(err)
}

/// Envoie des entraînements vers Hammerhead (mis à jour s’ils y sont déjà).
#[tauri::command]
async fn hammerhead_send_workouts(app: tauri::AppHandle, ids: Vec<i64>) -> CmdResult<SendReport> {
    tauri::async_runtime::spawn_blocking(move || -> CmdResult<SendReport> {
        let mut report = SendReport { sent: 0, updated: 0, errors: vec![] };
        for id in ids {
            let (w, existing) = {
                let state = app.state::<AppState>();
                let index = state.index.lock().map_err(err)?;
                (index.workout(id).map_err(err)?, index.workout_send(id, "hammerhead").map_err(err)?)
            };
            let result = std::fs::read(&w.path)
                .map_err(|e| format!("{} : {e}", w.path))
                .and_then(|bytes| hammerhead::send_workout(&w.workout.name, &bytes, existing.as_deref()));
            match result {
                Ok(external) => {
                    app.state::<AppState>().index.lock().map_err(err)?.set_workout_send(id, "hammerhead", &external, now()).map_err(err)?;
                    if existing.is_some() {
                        report.updated += 1
                    } else {
                        report.sent += 1
                    }
                }
                Err(e) => report.errors.push(format!("{} : {e}", w.workout.name)),
            }
        }
        Ok(report)
    })
    .await
    .map_err(err)?
}

// ---- Hammerhead (Karoo) ------------------------------------------------

#[tauri::command]
fn hammerhead_status() -> hammerhead::Status {
    hammerhead::status()
}

/// Application Hammerhead de l’utilisateur (secret vide : garder l’ancien).
#[tauri::command]
fn hammerhead_set_client(client_id: String, client_secret: String, redirect_uri: String) -> CmdResult<()> {
    hammerhead::set_client(&client_id, &client_secret, &redirect_uri)
}

/// Connexion du compte par le navigateur (attend le retour, 5 minutes au plus).
#[tauri::command]
async fn hammerhead_connect(app: tauri::AppHandle) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    tauri::async_runtime::spawn_blocking(move || {
        hammerhead::connect(|url| app.opener().open_url(url, None::<&str>).map_err(|e| format!("Navigateur : {e}")))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
fn hammerhead_reset_client() -> CmdResult<()> {
    hammerhead::reset_client()
}

#[tauri::command]
fn hammerhead_cancel() {
    hammerhead::cancel()
}

#[tauri::command]
fn hammerhead_disconnect() -> CmdResult<()> {
    hammerhead::disconnect()
}

/// Résultat d’un envoi vers le Karoo.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SendReport {
    sent: usize,
    updated: usize,
    errors: Vec<String>,
}

/// Envoie des traces vers le compte Hammerhead (le Karoo les récupère ensuite) :
/// une trace déjà envoyée est mise à jour, pas dupliquée. Avancement : « hammerhead-progress ».
#[tauri::command]
async fn hammerhead_send(app: tauri::AppHandle, ids: Vec<i64>) -> CmdResult<SendReport> {
    tauri::async_runtime::spawn_blocking(move || -> CmdResult<SendReport> {
        let total = ids.len();
        let mut report = SendReport { sent: 0, updated: 0, errors: vec![] };
        for (n, id) in ids.iter().enumerate() {
            let _ = app.emit("hammerhead-progress", KomootProgress { phase: "import", done: n, total });
            let (name, path, existing) = {
                let state = app.state::<AppState>();
                let index = state.index.lock().map_err(err)?;
                let t = index.get(*id).map_err(err)?;
                let existing = index.device_send(*id, "hammerhead").map_err(err)?.map(|s| s.0);
                (t.summary.name, t.summary.path, existing)
            };
            let result = traces_core::device::hammerhead_gpx(std::path::Path::new(&path))
                .map_err(|e| e.to_string())
                .and_then(|gpx| hammerhead::send_route(&name, &gpx, existing.as_deref()));
            match result {
                Ok(external) => {
                    let state = app.state::<AppState>();
                    state.index.lock().map_err(err)?.set_device_send(*id, "hammerhead", &external, now()).map_err(err)?;
                    if existing.is_some() {
                        report.updated += 1
                    } else {
                        report.sent += 1
                    }
                }
                Err(e) => report.errors.push(format!("{name} : {e}")),
            }
        }
        let _ = app.emit("hammerhead-progress", KomootProgress { phase: "import", done: total, total });
        Ok(report)
    })
    .await
    .map_err(err)?
}

/// Date d’envoi vers le Karoo (secondes Unix), si la trace y a été envoyée.
#[tauri::command]
fn hammerhead_sent_at(state: State<AppState>, id: i64) -> CmdResult<Option<i64>> {
    Ok(state.index.lock().map_err(err)?.device_send(id, "hammerhead").map_err(err)?.map(|s| s.1))
}

/// Retire la trace du compte Hammerhead (et donc du Karoo à la prochaine synchro).
#[tauri::command]
async fn hammerhead_remove(app: tauri::AppHandle, id: i64) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || -> CmdResult<()> {
        let existing = app.state::<AppState>().index.lock().map_err(err)?.device_send(id, "hammerhead").map_err(err)?;
        if let Some((external, _)) = existing {
            hammerhead::delete_route(&external)?;
        }
        app.state::<AppState>().index.lock().map_err(err)?.clear_device_send(id, "hammerhead").map_err(err)
    })
    .await
    .map_err(err)?
}

/// Fait d’une collection un tour (étapes ordonnées) ou l’inverse.
#[tauri::command]
fn set_collection_tour(state: State<AppState>, id: i64, is_tour: bool) -> CmdResult<()> {
    state.index.lock().map_err(err)?.set_collection_tour(id, is_tour).map_err(err)
}

/// Étapes d’un tour, dans l’ordre, avec leur profil et leurs POI.
#[tauri::command]
fn tour_stages(state: State<AppState>, id: i64) -> CmdResult<Vec<TraceDetail>> {
    state.index.lock().map_err(err)?.tour_stages(id).map_err(err)
}

#[tauri::command]
fn set_tour_order(state: State<AppState>, id: i64, ordered: Vec<i64>) -> CmdResult<()> {
    state.index.lock().map_err(err)?.set_tour_order(id, &ordered).map_err(err)
}

/// Exporte le tour en un seul GPX (une piste par étape) ; renvoie le nombre d’étapes.
#[tauri::command]
fn export_tour_gpx(state: State<AppState>, id: i64, path: String) -> CmdResult<usize> {
    traces_core::tour::export_tour_gpx(&*state.index.lock().map_err(err)?, id, std::path::Path::new(&path)).map_err(err)
}

/// Copie chaque étape dans un dossier (« 01 - nom.gpx »…).
#[tauri::command]
fn export_tour_stages(state: State<AppState>, id: i64, dir: String) -> CmdResult<Vec<String>> {
    traces_core::tour::export_tour_stages(&*state.index.lock().map_err(err)?, id, std::path::Path::new(&dir)).map_err(err)
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

/// Doublons mis de côté (`.organisons-doublons`), le plus récent d’abord.
#[tauri::command]
fn set_aside_list(state: State<AppState>) -> CmdResult<Vec<traces_core::TrashItem>> {
    organize::set_aside_list(&*state.index.lock().map_err(err)?).map_err(err)
}

/// Remet une trace de la corbeille ou des doublons mis de côté dans sa bibliothèque ; renvoie son identifiant.
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
            set_collection_tour,
            list_workouts,
            import_workouts,
            workouts_sent,
            zwift_folders,
            zwift_send,
            icu_status,
            icu_connect,
            icu_disconnect,
            icu_plan,
            hammerhead_send_workouts,
            hammerhead_status,
            hammerhead_set_client,
            hammerhead_connect,
            hammerhead_disconnect,
            hammerhead_cancel,
            hammerhead_reset_client,
            hammerhead_send,
            hammerhead_sent_at,
            hammerhead_remove,
            komoot_status,
            komoot_login,
            komoot_logout,
            komoot_tours,
            komoot_import,
            openrunner_import,
            tour_stages,
            set_tour_order,
            export_tour_gpx,
            export_tour_stages,
            set_tag_auto,
            set_tag_keywords,
            trash_trace,
            trash_info,
            purge_trash,
            trash_list,
            set_aside_list,
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
