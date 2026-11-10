// Types et appels vers le cœur Rust (commandes Tauri).
import { invoke } from '@tauri-apps/api/core'

export type Hilliness = 'FLAT' | 'HILLY' | 'MOUNTAINOUS'
export type Wind = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
export type PoiKind = 'control' | 'warning' | 'water' | 'shop' | 'sight' | 'other'
export type SortKey = 'date' | 'distance' | 'elevation' | 'hilliness' | 'name' | 'sport'

export interface Library {
  id: number
  name: string
  path: string
  mode: 'index' | 'managed'
  pattern: string
  /** Écrire les tags et notes dans les fichiers GPX. */
  writeGpx: boolean
}

export interface PlannedMove {
  traceId: number
  name: string
  from: string
  to: string
}

export interface OrganizeReport {
  moved: number
  imported: number
  errors: string[]
  importedIds: number[]
  /** Non importés car déjà présents dans la bibliothèque. */
  skipped: string[]
}
/** Fichier à importer comparé à la bibliothèque. */
export interface ImportCheck {
  file: string
  name: string
  status: 'new' | 'identical' | 'probable' | 'error'
  matches: string[]
  error: string | null
}


export interface TraceSummary {
  id: number
  libraryId: number
  path: string
  name: string
  distanceKm: number
  elevationGain: number
  hilliness: Hilliness
  wind: Wind
  surfaceType: string | null
  source: string
  /** Dossier de sport (« Route », « Gravel »…). */
  sport: string
  tags: string[]
  poiCount: number
  addedAt: number
  /** [lat, lon] */
  preview: [number, number][]
}

export interface ProfilePoint {
  km: number
  lat: number
  lon: number
  ele: number
  slope: number
  slopeMax: number
  up: number
  down: number
  minutes: number | null
}

export interface Poi {
  name: string
  kind: PoiKind
  km: number
  lat: number
  lon: number
  symbol: string | null
}

export type SurfaceClass = 'paved' | 'cobbles' | 'gravel' | 'unpaved' | 'unknown'

export interface SurfaceRun {
  fromKm: number
  toKm: number
  class: SurfaceClass
}

export interface TraceDetail extends TraceSummary {
  elevationLoss: number
  eleMin: number
  eleMax: number
  notes: string
  hasTime: boolean
  creator: string | null
  collectionIds: number[]
  profile: ProfilePoint[]
  /** Revêtement calculé depuis OpenStreetMap (null tant qu’il n’a pas été demandé). */
  surface: SurfaceRun[] | null
  /** Tags détectés dans le titre et les métadonnées, à valider. */
  tagSuggestions: string[]
  pois: Poi[]
}

export interface TraceFilter {
  query?: string
  distanceMin?: number
  distanceMax?: number
  elevationMin?: number
  elevationMax?: number
  hilliness?: Hilliness
  surfaceType?: string
  sport?: string
  wind?: Wind
  windNear?: boolean
  source?: string
  tag?: string
  collection?: number
  sort?: SortKey
  ascending?: boolean
}

export interface ScanReport {
  added: number
  updated: number
  unchanged: number
  removed: number
  errors: string[]
}

export interface DuplicateGroup {
  hash: string
  paths: string[]
}

export interface DuplicateSet {
  /** identical : même fichier octet pour octet ; probable : même parcours. */
  kind: 'identical' | 'probable'
  traces: TraceSummary[]
}

export interface SetAsideInfo {
  count: number
  bytes: number
  /** Date de mise de côté la plus ancienne (secondes Unix). */
  oldest: number | null
}

export interface Collection {
  id: number
  name: string
  count: number
  /** Tour : les traces sont des étapes ordonnées. */
  isTour: boolean
}

export interface TagCount {
  tag: string
  count: number
  /** Cherché automatiquement dans les titres et métadonnées des GPX. */
  auto: boolean
  /** Autres mots cherchés pour proposer ce tag. */
  keywords: string[]
}

export const api = {
  listLibraries: () => invoke<Library[]>('list_libraries'),
  addLibrary: (name: string, path: string, mode: Library['mode'] = 'index', writeGpx = mode === 'managed') =>
    invoke<ScanReport>('add_library', { name, path, mode, writeGpx }),
  removeLibrary: (id: number) => invoke<void>('remove_library', { id }),
  setLibraryWriteGpx: (id: number, writeGpx: boolean) => invoke<void>('set_library_write_gpx', { id, writeGpx }),
  planOrganize: (libraryId: number) => invoke<PlannedMove[]>('plan_organize', { libraryId }),
  applyOrganize: (libraryId: number, moves: PlannedMove[]) => invoke<OrganizeReport>('apply_organize', { libraryId, moves }),
  importFiles: (libraryId: number, files: string[]) => invoke<OrganizeReport>('import_files', { libraryId, files }),
  setSport: (id: number, sport: string | null) => invoke<void>('set_sport', { id, sport }),
  ignoreTagSuggestions: (id: number, tags: string[]) => invoke<void>('ignore_tag_suggestions', { id, tags }),
  setLibraryPattern: (id: number, pattern: string) => invoke<void>('set_library_pattern', { id, pattern }),
  previewPattern: (pattern: string) => invoke<string>('preview_pattern', { pattern }),
  checkImport: (files: string[]) => invoke<ImportCheck[]>('check_import', { files }),
  offlineLibraries: () => invoke<number[]>('offline_libraries'),
  trashTrace: (id: number) => invoke<string>('trash_trace', { id }),
  trashInfo: () => invoke<SetAsideInfo>('trash_info'),
  trashList: () => invoke<TrashItem[]>('trash_list'),
  setAsideList: () => invoke<TrashItem[]>('set_aside_list'),
  restoreTrash: (path: string) => invoke<number>('restore_trash', { path }),
  purgeTrash: (olderThanDays?: number) => invoke<number>('purge_trash', { olderThanDays: olderThanDays ?? null }),
  getTrashPurgeDays: () => invoke<number>('get_trash_purge_days'),
  setTrashPurgeDays: (days: number) => invoke<void>('set_trash_purge_days', { days }),
  createTag: (name: string) => invoke<void>('create_tag', { name }),
  batchEdit: (ids: number[], edit: BatchEdit) => invoke<string[]>('batch_edit', { ids, edit }),
  setCollectionTour: (id: number, isTour: boolean) => invoke<void>('set_collection_tour', { id, isTour }),
  listWorkouts: () => invoke<WorkoutSummary[]>('list_workouts'),
  zwiftFolders: () => invoke<string[]>('zwift_folders'),
  zwiftSend: (ids: number[], folder: string) => invoke<string[]>('zwift_send', { ids, folder }),
  icuStatus: () => invoke<IcuStatus>('icu_status'),
  icuConnect: (athleteId: string, apiKey: string) => invoke<IcuStatus>('icu_connect', { athleteId, apiKey }),
  icuDisconnect: () => invoke<void>('icu_disconnect'),
  icuPlan: (ids: number[], date: string) => invoke<string[]>('icu_plan', { ids, date }),
  importWorkouts: (libraryId: number, files: string[]) => invoke<OrganizeReport>('import_workouts', { libraryId, files }),
  workoutsSent: () => invoke<number[]>('workouts_sent'),
  hammerheadSendWorkouts: (ids: number[]) => invoke<SendReport>('hammerhead_send_workouts', { ids }),
  hammerheadStatus: () => invoke<HammerheadStatus>('hammerhead_status'),
  hammerheadSetClient: (clientId: string, clientSecret: string, redirectUri: string) =>
    invoke<void>('hammerhead_set_client', { clientId, clientSecret, redirectUri }),
  hammerheadConnect: () => invoke<void>('hammerhead_connect'),
  hammerheadDisconnect: () => invoke<void>('hammerhead_disconnect'),
  hammerheadCancel: () => invoke<void>('hammerhead_cancel'),
  hammerheadResetClient: () => invoke<void>('hammerhead_reset_client'),
  hammerheadSend: (ids: number[]) => invoke<SendReport>('hammerhead_send', { ids }),
  hammerheadSentAt: (id: number) => invoke<number | null>('hammerhead_sent_at', { id }),
  hammerheadRemove: (id: number) => invoke<void>('hammerhead_remove', { id }),
  komootStatus: () => invoke<KomootAccount | null>('komoot_status'),
  komootLogin: (email: string, password: string) => invoke<KomootAccount>('komoot_login', { email, password }),
  komootLogout: () => invoke<void>('komoot_logout'),
  komootTours: () => invoke<KomootTour[]>('komoot_tours'),
  komootImport: (libraryId: number, ids: string[]) => invoke<OrganizeReport>('komoot_import', { libraryId, ids }),
  openrunnerImport: (libraryId: number, links: string[]) => invoke<OrganizeReport>('openrunner_import', { libraryId, links }),
  tourStages: (id: number) => invoke<TraceDetail[]>('tour_stages', { id }),
  setTourOrder: (id: number, ordered: number[]) => invoke<void>('set_tour_order', { id, ordered }),
  exportTourGpx: (id: number, path: string) => invoke<number>('export_tour_gpx', { id, path }),
  exportTourStages: (id: number, dir: string) => invoke<string[]>('export_tour_stages', { id, dir }),
  setTagAuto: (tag: string, auto: boolean) => invoke<void>('set_tag_auto', { tag, auto }),
  setTagKeywords: (tag: string, keywords: string[]) => invoke<void>('set_tag_keywords', { tag, keywords }),
  setSurface: (id: number, ways: { tags: Record<string, string>; geometry: [number, number][] }[]) =>
    invoke<SurfaceRun[]>('set_surface', { id, ways }),
  sports: () => invoke<string[]>('sports'),
  scanAll: () => invoke<ScanReport>('scan_all'),
  listTraces: (filter: TraceFilter) => invoke<TraceSummary[]>('list_traces', { filter }),
  getTrace: (id: number) => invoke<TraceDetail>('get_trace', { id }),
  setTags: (id: number, tags: string[]) => invoke<void>('set_tags', { id, tags }),
  setNotes: (id: number, notes: string) => invoke<void>('set_notes', { id, notes }),
  allTags: () => invoke<string[]>('all_tags'),
  duplicates: () => invoke<DuplicateGroup[]>('duplicates'),
  collections: () => invoke<Collection[]>('collections'),
  createCollection: (name: string) => invoke<Collection>('create_collection', { name }),
  renameCollection: (id: number, name: string) => invoke<void>('rename_collection', { id, name }),
  deleteCollection: (id: number) => invoke<void>('delete_collection', { id }),
  setTraceCollections: (id: number, collectionIds: number[]) => invoke<void>('set_trace_collections', { id, collectionIds }),
  tagCounts: () => invoke<TagCount[]>('tag_counts'),
  /** Renvoie les erreurs d'écriture dans les GPX (l'index est à jour dans tous les cas). */
  renameTag: (old: string, newName: string) => invoke<string[]>('rename_tag', { old, new: newName }),
  deleteTag: (tag: string) => invoke<string[]>('delete_tag', { tag }),
  duplicateSets: () => invoke<DuplicateSet[]>('duplicate_sets'),
  markNotDuplicates: (ids: number[]) => invoke<void>('mark_not_duplicates', { ids }),
  setAsideDuplicate: (id: number) => invoke<string>('set_aside_duplicate', { id }),
  setAsideInfo: () => invoke<SetAsideInfo>('set_aside_info'),
  /** Suppression définitive ; tous les fichiers si `olderThanDays` est absent. */
  purgeSetAside: (olderThanDays?: number) => invoke<number>('purge_set_aside', { olderThanDays }),
  getPurgeDays: () => invoke<number>('get_purge_days'),
  setPurgeDays: (days: number) => invoke<void>('set_purge_days', { days }),
}

/** Fichier de la corbeille d'Organisons. */
export interface TrashItem {
  path: string
  name: string
  file: string
  libraryId: number
  library: string
  deletedAt: number
  bytes: number
}

/** Modification de plusieurs traces à la fois. */
export interface BatchEdit {
  addTags?: string[]
  removeTags?: string[]
  /** Changer le sport ; `sport` vide = revenir au sport lu dans le GPX. */
  changeSport?: boolean
  sport?: string | null
  /** Par nom ; créées si elles n'existent pas. */
  addCollections?: string[]
  removeCollections?: number[]
}

/** Compte Komoot connecté (le jeton reste côté Rust). */
export interface KomootAccount {
  email: string
  displayName: string
}

/** Parcours du compte Komoot. */
export interface KomootTour {
  id: string
  name: string
  kind: 'planned' | 'recorded'
  sport: string
  distanceKm: number
  elevationUp: number
  date: string | null
  imported: boolean
}

/** Application et compte Hammerhead (le secret et le jeton restent côté Rust). */
export interface HammerheadStatus {
  configured: boolean
  clientId: string
  redirectUri: string
  connected: boolean
  /** Application d’Organisons intégrée à l’appli (rien à saisir). */
  builtin: boolean
  builtinAvailable: boolean
}

/** Résultat d'un envoi vers le Karoo. */
export interface SendReport {
  sent: number
  updated: number
  errors: string[]
}

/** Bloc d'une séance (.zwo), puissances en fraction de FTP. */
export interface WorkoutBlock {
  kind: 'warmup' | 'cooldown' | 'steady' | 'on' | 'off' | 'ramp' | 'free' | 'max'
  start: number
  duration: number
  from: number
  to: number
  cadence: number | null
}

/** Entraînement (.zwo) de la bibliothèque. */
export interface WorkoutSummary {
  id: number
  libraryId: number
  path: string
  name: string
  author: string
  description: string
  sport: string
  tags: string[]
  /** secondes */
  duration: number
  /** facteur d'intensité */
  intensity: number
  tss: number
  blocks: WorkoutBlock[]
  addedAt: number
}

/** Compte intervals.icu (la clé d'API reste côté Rust). */
export interface IcuStatus {
  connected: boolean
  athleteId: string
  name: string
}
