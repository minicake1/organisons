import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Poi, ProfilePoint } from '../api'
import { int, km1, niceStep } from '../labels'
import { poiMarker, poiTip } from './PoiCategory'
import { boundsOf, line, setGeoJson, useMapLibre } from './useMapLibre'

interface Props {
  profile: ProfilePoint[]
  pois: Poi[]
  cursor: number | null
  /** Couleur de chaque tronçon (pente ou revêtement). */
  colors: string[]
  /** Partie de la trace visible sur la carte (km), ou null si elle est entière. */
  onView?: (range: [number, number] | null) => void
  /** Partie de la trace entourée d’un léger halo lumineux (étape survolée d’un tour), en [lon, lat]. */
  glow?: [number, number][] | null
  /** Mode « placer un point » : curseur en croix, un clic donne la position. */
  onPick?: (lat: number, lon: number) => void
}

const ll = (p: ProfilePoint) => [p.lon, p.lat] as [number, number]

/** En dessous de ce zoom, les noms des POI se chevauchent : on n'affiche que les pastilles. */
const POI_LABEL_MIN_ZOOM = 11

export default function TraceMap({ profile, pois, cursor, colors, onView, glow, onPick }: Props) {
  const { container, map, fitTo } = useMapLibre()
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
      const color = colors[i] ?? '#343a40'
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
      if (b) fitTo(b, { padding: 50, duration: 0 })
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
  }, [map, profile, colors, total])

  // Points d'intérêt affichés, avec une info-bulle colorée au survol (repères communs : PoiCategory).
  useEffect(() => {
    if (!map) return
    poiMarkers.current.forEach((m) => m.remove())
    const tip = poiTip()
    poiMarkers.current = pois.map((p) => poiMarker(map, tip, p, `km ${km1(p.km)}`))
    return () => {
      tip.remove()
    }
  }, [map, pois])

  // Noms des POI masqués sur une vue d'ensemble, affichés en zoomant.
  useEffect(() => {
    if (!map) return
    const update = () =>
      map.getContainer().classList.toggle('poi-labels-off', map.getZoom() < POI_LABEL_MIN_ZOOM)
    update()
    map.on('zoom', update)
    return () => {
      map.off('zoom', update)
    }
  }, [map])

  // Zoom de la carte → partie du profil affichée. Si la trace passe plusieurs
  // fois dans la vue (boucle), on garde le plus long passage visible.
  useEffect(() => {
    if (!map || !onView || profile.length < 2) return
    const update = () => {
      const b = map.getBounds()
      const gap = total * 0.02
      let best: [number, number] | null = null
      let run: [number, number] | null = null
      let lastKm = -Infinity
      let count = 0
      for (const p of profile) {
        if (!b.contains([p.lon, p.lat])) continue
        count++
        if (run && p.km - lastKm <= gap) run[1] = p.km
        else run = [p.km, p.km]
        lastKm = p.km
        if (!best || run[1] - run[0] > best[1] - best[0]) best = [run[0], run[1]]
      }
      // Trace entière visible, ou presque rien : profil complet.
      if (!best || count === profile.length || best[1] - best[0] < total * 0.002) onView(null)
      else onView(best)
    }
    update()
    map.on('moveend', update)
    return () => {
      map.off('moveend', update)
    }
  }, [map, profile, total, onView])

  // Placer un point : clic sur la carte.
  useEffect(() => {
    if (!map || !onPick) return
    const canvas = map.getCanvas()
    canvas.style.cursor = 'crosshair'
    const click = (e: maplibregl.MapMouseEvent) => onPick(e.lngLat.lat, e.lngLat.lng)
    map.on('click', click)
    return () => {
      canvas.style.cursor = ''
      map.off('click', click)
    }
  }, [map, onPick])

  // Halo lumineux sous la partie survolée (étape d’un tour).
  useEffect(() => {
    if (!map || !map.getLayer("track-halo")) return
    setGeoJson(map, "glow", line(glow ?? []))
    if (!map.getLayer("glow")) {
      map.addLayer(
        {
          id: "glow",
          type: "line",
          source: "glow",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#ffe066", "line-width": 16, "line-blur": 7, "line-opacity": 0.85 },
        },
        "track-halo",
      )
    }
  }, [map, glow, profile])

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
