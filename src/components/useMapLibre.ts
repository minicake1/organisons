import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'

/** Fond de carte vectoriel gratuit, sans clé (OpenFreeMap, données OpenStreetMap). */
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const OFFLINE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'fond', type: 'background', paint: { 'background-color': '#eef1ea' } }],
}

type Home = { bounds: maplibregl.LngLatBounds; options: maplibregl.FitBoundsOptions }

/** Bouton « Recentrer sur la trace », placé sous le zoom et le plein écran. */
class RecenterControl implements maplibregl.IControl {
  private box?: HTMLDivElement
  constructor(private home: () => Home | null) {}
  onAdd(map: maplibregl.Map) {
    this.box = document.createElement('div')
    this.box.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'map-recenter'
    b.title = 'Recentrer sur la trace'
    b.setAttribute('aria-label', b.title)
    b.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/></svg>'
    b.onclick = () => {
      const h = this.home()
      if (h) map.fitBounds(h.bounds, { ...h.options, duration: 500 })
    }
    this.box.appendChild(b)
    return this.box
  }
  onRemove() {
    this.box?.remove()
  }
}

/** Crée une carte MapLibre dans le conteneur et renvoie l'instance une fois chargée. */
export function useMapLibre() {
  const container = useRef<HTMLDivElement | null>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const home = useRef<Home | null>(null)

  useEffect(() => {
    if (!container.current) return
    const m = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE,
      center: [2.5, 46.5],
      zoom: 5,
      attributionControl: { compact: true },
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.addControl(new maplibregl.FullscreenControl(), 'top-right')
    m.addControl(new RecenterControl(() => home.current), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    m.on('load', () => setMap(m))
    // Sans internet (ou si le fond de carte ne répond pas), on garde un fond
    // uni pour que la trace reste visible.
    let fellBack = false
    m.on('error', (e) => {
      if (fellBack || m.isStyleLoaded()) return
      console.warn('Fond de carte indisponible, fond uni utilisé', e.error)
      fellBack = true
      m.setStyle(OFFLINE_STYLE)
    })
    return () => {
      setMap(null)
      m.remove()
    }
  }, [])

  /** Cadre la carte et mémorise ce cadrage pour le bouton « Recentrer ». */
  const fitTo = (bounds: maplibregl.LngLatBounds, options: maplibregl.FitBoundsOptions) => {
    home.current = { bounds, options }
    map?.fitBounds(bounds, options)
  }

  return { container, map, fitTo }
}

type Line = GeoJSON.Feature<GeoJSON.LineString, Record<string, unknown>>

/** Ajoute ou remplace une source GeoJSON. */
export function setGeoJson(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection | Line) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
  if (src) src.setData(data)
  else map.addSource(id, { type: 'geojson', data })
}

export function line(coords: [number, number][], properties: Record<string, unknown> = {}): Line {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } }
}

export function boundsOf(coords: [number, number][]): maplibregl.LngLatBounds | null {
  if (!coords.length) return null
  const b = new maplibregl.LngLatBounds(coords[0], coords[0])
  coords.forEach((c) => b.extend(c))
  return b
}
