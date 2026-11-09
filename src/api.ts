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

export interface TraceDetail extends TraceSummary {
  elevationLoss: number
  eleMin: number
  eleMax: number
  notes: string
  hasTime: boolean
  creator: string | null
  profile: ProfilePoint[]
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
  wind?: Wind
  windNear?: boolean
  source?: string
  tag?: string
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

export const api = {
  listLibraries: () => invoke<Library[]>('list_libraries'),
  addLibrary: (name: string, path: string, mode: Library['mode'] = 'index') =>
    invoke<ScanReport>('add_library', { name, path, mode }),
  removeLibrary: (id: number) => invoke<void>('remove_library', { id }),
  scanAll: () => invoke<ScanReport>('scan_all'),
  listTraces: (filter: TraceFilter) => invoke<TraceSummary[]>('list_traces', { filter }),
  getTrace: (id: number) => invoke<TraceDetail>('get_trace', { id }),
  setTags: (id: number, tags: string[]) => invoke<void>('set_tags', { id, tags }),
  setNotes: (id: number, notes: string) => invoke<void>('set_notes', { id, notes }),
  setSurfaceType: (id: number, surface: string | null) => invoke<void>('set_surface_type', { id, surface }),
  allTags: () => invoke<string[]>('all_tags'),
  duplicates: () => invoke<DuplicateGroup[]>('duplicates'),
}
