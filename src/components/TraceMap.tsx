import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { Poi, ProfilePoint } from '../api'
import { int, niceStep, poiKind, slopeColor } from '../labels'
import { boundsOf, line, setGeoJson, useMapLibre } from './useMapLibre'

interface Props {
  profile: ProfilePoint[]
  pois: Poi[]
  cursor: number | null
  colorBySlope: boolean
}

const ll = (p: ProfilePoint) => [p.lon, p.lat] as [number, number]

export default function TraceMap({ profile, pois, cursor, colorBySlope }: Props) {
  const { container, map } = useMapLibre()
  const markers = useRef<maplibregl.Marker[]>([])
  const poiMarkers = useRef<maplibregl.Marker[]>([])
  const total = profile[profile.length - 1]?.km ?? 0

  // Trace, bornes kilométriques, départ.
  useEffect(() => {
    if (!map || !profile.length) return
    const coords = profile.map(ll)
    setGeoJson(map, 'track', line(coords))
    // Tronçons colorés par pente, regroupés par couleur consécutive.
    const segs: GeoJSON.Feature<GeoJSON.LineString>[] = []
    let cur: { color: string; coords: [number, number][] } | null = null
    profile.forEach((p, i) => {
      const color = colorBySlope ? slopeColor(p.slopeMax) : '#343a40'
      if (!cur || cur.color !== color) {
        if (cur) segs.push(line(cur.coords, { color: cur.color }))
        cur = { color, coords: i ? [ll(profile[i - 1])] : [] }
      }
      cur.coords.push(ll(p))
    })
    if (cur) segs.push(line((cur as { coords: [number, number][] }).coords, { color: (cur as { color: string }).color }))
    setGeoJson(map, 'track-colored', { type: 'FeatureCollection', features: segs })
    if (!map.getLayer('track-halo')) {
      const layout = { 'line-join': 'round', 'line-cap': 'round' } as const
      map.addLayer({ id: 'track-halo', type: 'line', source: 'track', paint: { 'line-color': '#fff', 'line-width': 9 }, layout })
      map.addLayer({ id: 'track-line', type: 'line', source: 'track-colored', paint: { 'line-color': ['get', 'color'], 'line-width': 4 }, layout })
      setGeoJson(map, 'done', line([]))
      map.addLayer({ id: 'done-halo', type: 'line', source: 'done', paint: { 'line-color': '#e03131', 'line-opacity': 0.3, 'line-width': 14 }, layout })
      map.addLayer({ id: 'done-line', type: 'line', source: 'done', paint: { 'line-color': '#c92a2a', 'line-width': 2.5 }, layout })
      setGeoJson(map, 'cursor', { type: 'FeatureCollection', features: [] })
      map.addLayer({ id: 'cursor', type: 'circle', source: 'cursor', paint: { 'circle-radius': 8, 'circle-color': '#212529', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } })
      const b = boundsOf(coords)
      if (b) map.fitBounds(b, { padding: 50, duration: 0 })
    }

    markers.current.forEach((m) => m.remove())
    markers.current = []
    const step = niceStep(total / 7, [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500])
    for (let k = step; k < total - step * 0.4; k += step) {
      const p = profile[Math.round((k / total) * (profile.length - 1))]
      const el = document.createElement('div')
      el.className = 'km-mark'
      el.textContent = int(k)
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(ll(p)).addTo(map))
    }
    const start = document.createElement('div')
    start.className = 'start-mark'
    start.textContent = 'D'
    markers.current.push(new maplibregl.Marker({ element: start }).setLngLat(ll(profile[0])).addTo(map))
  }, [map, profile, colorBySlope, total])

  // Points d'intérêt affichés.
  useEffect(() => {
    if (!map) return
    poiMarkers.current.forEach((m) => m.remove())
    poiMarkers.current = pois.map((p) => {
      const k = poiKind(p.kind)
      const el = document.createElement('div')
      if (k.big) {
        el.className = 'poi-big'
        const label = document.createElement('span')
        label.className = 'label'
        label.style.background = k.color
        label.textContent = p.name
        const pin = document.createElement('span')
        pin.className = 'pin'
        pin.style.background = k.color
        pin.textContent = p.kind === 'control' ? '✓' : '!'
        el.append(label, pin)
        return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map)
      }
      el.className = 'poi-small'
      el.style.background = k.color
      el.title = p.name
      return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map)
    })
  }, [map, pois])

  // Curseur du profil → point et partie parcourue sur la carte.
  useEffect(() => {
    if (!map || !map.getSource('done')) return
    if (cursor == null) {
      setGeoJson(map, 'done', line([]))
      setGeoJson(map, 'cursor', { type: 'FeatureCollection', features: [] })
      return
    }
    setGeoJson(map, 'done', line(profile.slice(0, cursor + 1).map(ll)))
    setGeoJson(map, 'cursor', {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ll(profile[cursor]) } }],
    })
  }, [map, cursor, profile])

  return <div ref={container} style={{ position: 'absolute', inset: 0 }} />
}
