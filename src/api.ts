// Types et appels vers le cœur Rust (commandes Tauri).
import { invoke } from '@tauri-apps/api/core'

export type Hilliness = 'FLAT' | 'HILLY' | 'MOUNTAINOUS'
export type Wind = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
export type PoiKind = 'control' | 'warning' | 'water' | 'shop' | 'sight' | 'other'
export type SortKey = 'date' | 'distance' | 'elevation' | 'hilliness' | 'name'

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
}

export interface TagCount {
  tag: string
  count: number
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
