// Vignettes avec fond de carte : une seule carte MapLibre cachée « photographie »
// les traces une par une (une carte WebGL par vignette serait trop lourde : le
// navigateur limite le nombre de contextes WebGL). Les images restent en
// mémoire pendant la session.
import maplibregl from 'maplibre-gl'
import { MAP_STYLE } from './useMapLibre'

/** Taille affichée de la vignette (rendue en ×2 pour la netteté). */
export const THUMB_W = 300
export const THUMB_H = 180

type Job = {
  key: string
  coords: [number, number][]
  cancelled: boolean
  resolve: (url: string) => void
  reject: (e: unknown) => void
}

const cache = new Map<string, string>()
const queue: Job[] = []
let mapPromise: Promise<maplibregl.Map> | null = null
let running = false

const EMPTY: GeoJSON.Feature<GeoJSON.LineString> = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }

function getMap(): Promise<maplibregl.Map> {
  if (mapPromise) return mapPromise
  mapPromise = new Promise((resolve, reject) => {
    const el = document.createElement('div')
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText = `position:fixed;left:-10000px;top:0;width:${THUMB_W}px;height:${THUMB_H}px;pointer-events:none;`
    document.body.appendChild(el)
    const m = new maplibregl.Map({
      container: el,
      style: MAP_STYLE,
      interactive: false,
      attributionControl: false,
      pixelRatio: 2,
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    let loaded = false
    const fail = (e: unknown) => {
      if (loaded) return
      m.remove()
      el.remove()
      mapPromise = null
      reject(e)
    }
    const timer = setTimeout(() => fail(new Error('fond de carte indisponible')), 15000)
    m.on('error', (e) => {
      if (!m.isStyleLoaded()) fail(e.error)
    })
    m.on('load', () => {
      loaded = true
      clearTimeout(timer)
      m.addSource('t', { type: 'geojson', data: EMPTY })
      const layout = { 'line-join': 'round', 'line-cap': 'round' } as const
      m.addLayer({ id: 't-halo', type: 'line', source: 't', layout, paint: { 'line-color': '#ffffff', 'line-width': 6 } })
      m.addLayer({ id: 't-line', type: 'line', source: 't', layout, paint: { 'line-color': '#e03131', 'line-width': 3 } })
      resolve(m)
    })
  })
  return mapPromise
}

/** Attend que la carte ait fini de charger ses tuiles (au plus `ms`). */
function idle(m: maplibregl.Map, ms: number) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    m.once('idle', () => {
      clearTimeout(t)
      resolve()
    })
    m.triggerRepaint()
  })
}

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      if (job.cancelled) continue
      try {
        const m = await getMap()
        ;(m.getSource('t') as maplibregl.GeoJSONSource).setData({ ...EMPTY, geometry: { type: 'LineString', coordinates: job.coords } })
        const b = new maplibregl.LngLatBounds(job.coords[0], job.coords[0])
        job.coords.forEach((c) => b.extend(c))
        m.fitBounds(b, { padding: 22, duration: 0, maxZoom: 15 })
        await idle(m, 8000)
        const url = m.getCanvas().toDataURL('image/jpeg', 0.85)
        cache.set(job.key, url)
        job.resolve(url)
      } catch (e) {
        job.reject(e)
        // Hors ligne : inutile d'essayer les suivantes, elles gardent le dessin simple.
        queue.splice(0).forEach((j) => j.reject(e))
      }
    }
  } finally {
    running = false
  }
}

/**
 * Demande l'image d'une vignette. `preview` est en [lat, lon].
 * Renvoie l'image tout de suite si elle est en cache, sinon une promesse et
 * une fonction d'annulation (vignette sortie de l'écran).
 */
export function requestThumb(key: string, preview: [number, number][]): { cached?: string; promise?: Promise<string>; cancel: () => void } {
  const hit = cache.get(key)
  if (hit) return { cached: hit, cancel: () => {} }
  if (preview.length < 2) return { cancel: () => {} }
  let job!: Job
  const promise = new Promise<string>((resolve, reject) => {
    job = { key, coords: preview.map(([lat, lon]) => [lon, lat]), cancelled: false, resolve, reject }
  })
  queue.push(job)
  pump()
  return {
    promise,
    cancel: () => {
      job.cancelled = true
    },
  }
}
