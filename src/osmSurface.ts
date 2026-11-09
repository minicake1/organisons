// Revêtement depuis OpenStreetMap, comme Pédalons : les voies et leur revêtement
// sont lus dans les tuiles vectorielles OSM au schéma Shortbread de VersaTiles
// (gratuites, sans clé, servies par un CDN, donc rapides même pour 600 km).
// On télécharge les tuiles au zoom 14 qui couvrent la trace, on garde les voies
// proches de la trace, puis le cœur Rust les associe à la trace et enregistre
// le résultat dans l'index.
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { api, type ProfilePoint, type SurfaceRun } from './api'

const TILE_URL = 'https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}'
const Z = 14
/** Téléchargements simultanés. */
const PARALLEL = 6
/** Une voie est gardée si un de ses points est à moins de ~100 m de la trace. */
const NEAR_DEG = 0.001

/** Voies ferrées de la couche `streets` : jamais retenues. */
const RAIL = new Set(['rail', 'light_rail', 'subway', 'tram', 'narrow_gauge', 'funicular', 'monorail', 'miniature'])

type Way = { tags: Record<string, string>; geometry: [number, number][] }

const tileX = (lon: number) => Math.floor(((lon + 180) / 360) * 2 ** Z)
const tileY = (lat: number) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z)
}

/** Points de la trace tous les ~100 m (interpolés entre les points du profil). */
function densify(profile: ProfilePoint[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i]
    const b = profile[i + 1]
    const n = Math.max(1, Math.ceil((b.km - a.km) / 0.1))
    for (let k = 0; k < n; k++) out.push([a.lat + ((b.lat - a.lat) * k) / n, a.lon + ((b.lon - a.lon) * k) / n])
  }
  const last = profile[profile.length - 1]
  if (last) out.push([last.lat, last.lon])
  return out
}

/** Tuiles qui couvrent la trace, avec une marge pour les voies près d'un bord de tuile. */
function tilesFor(points: [number, number][]): [number, number][] {
  const set = new Set<string>()
  for (const [lat, lon] of points) {
    for (const dlat of [-0.0004, 0, 0.0004]) {
      for (const dlon of [-0.0006, 0, 0.0006]) set.add(`${tileX(lon + dlon)}/${tileY(lat + dlat)}`)
    }
  }
  return [...set].map((s) => s.split('/').map(Number) as [number, number])
}

async function fetchTile(x: number, y: number): Promise<ArrayBuffer | null> {
  const url = TILE_URL.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y))
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url)
      if (r.status === 204 || r.status === 404) return null // tuile vide (mer)
      if (r.ok) return await r.arrayBuffer()
    } catch {
      // réseau : on réessaie
    }
    await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
  }
  throw new Error('Les tuiles OpenStreetMap sont injoignables (connexion internet ?)')
}

/** Voies de la couche `streets` d'une tuile, en [lat, lon], gardées si proches de la trace. */
function waysOf(buf: ArrayBuffer, x: number, y: number, near: Set<string>): Way[] {
  const layer = new VectorTile(new Pbf(buf)).layers.streets
  if (!layer) return []
  const n = 2 ** Z
  const out: Way[] = []
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i)
    const p = f.properties
    if (f.type !== 2 || p.rail === true || typeof p.kind !== 'string' || RAIL.has(p.kind)) continue
    const tags: Record<string, string> = { highway: p.kind }
    if (typeof p.surface === 'string') tags.surface = p.surface
    if (typeof p.tracktype === 'string') tags.tracktype = p.tracktype
    for (const line of f.loadGeometry()) {
      const geometry = line.map((pt) => {
        const lon = ((x + pt.x / f.extent) / n) * 360 - 180
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + pt.y / f.extent)) / n))) * 180) / Math.PI
        return [lat, lon] as [number, number]
      })
      if (geometry.length > 1 && geometry.some(([la, lo]) => near.has(cellKey(la, lo)))) out.push({ tags, geometry })
    }
  }
  return out
}

const cellKey = (lat: number, lon: number) => `${Math.round(lat / NEAR_DEG)}:${Math.round(lon / NEAR_DEG)}`

/** Calcule et enregistre le revêtement d'une trace ; `onProgress` reçoit (tuiles lues, total). */
export async function computeSurface(
  id: number,
  profile: ProfilePoint[],
  onProgress: (done: number, total: number) => void,
): Promise<SurfaceRun[]> {
  const points = densify(profile)
  // Cases d'environ 100 m autour de la trace, pour trier vite les voies proches.
  const near = new Set<string>()
  for (const [lat, lon] of points) {
    const a = Math.round(lat / NEAR_DEG)
    const b = Math.round(lon / NEAR_DEG)
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) near.add(`${a + i}:${b + j}`)
  }
  const tiles = tilesFor(points)
  const ways: Way[] = []
  let done = 0
  let next = 0
  onProgress(0, tiles.length)
  const worker = async () => {
    while (next < tiles.length) {
      const [x, y] = tiles[next++]
      const buf = await fetchTile(x, y)
      if (buf) ways.push(...waysOf(buf, x, y, near))
      onProgress(++done, tiles.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, tiles.length) }, worker))
  return api.setSurface(id, ways)
}
