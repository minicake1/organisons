import { useEffect } from 'react'
import type { TraceSummary } from '../api'
import { boundsOf, line, setGeoJson, useMapLibre } from './useMapLibre'

const toLngLat = (p: [number, number][]) => p.map(([lat, lon]) => [lon, lat] as [number, number])

/** Carte centrée sur une seule trace (affichage « liste + carte »). */
export function SelectedTraceMap({ trace }: { trace: TraceSummary | null }) {
  const { container, map, fitTo } = useMapLibre()
  useEffect(() => {
    if (!map) return
    const coords = trace ? toLngLat(trace.preview) : []
    setGeoJson(map, 'sel', line(coords))
    if (!map.getLayer('sel-halo')) {
      map.addLayer({ id: 'sel-halo', type: 'line', source: 'sel', paint: { 'line-color': '#ffffff', 'line-width': 9 }, layout: { 'line-join': 'round', 'line-cap': 'round' } })
      map.addLayer({ id: 'sel-line', type: 'line', source: 'sel', paint: { 'line-color': '#4263eb', 'line-width': 5 }, layout: { 'line-join': 'round', 'line-cap': 'round' } })
    }
    const b = boundsOf(coords)
    // Marge basse pour laisser la place à l'encadré de résumé.
    if (b) fitTo(b, { padding: { top: 40, left: 40, right: 60, bottom: 150 }, duration: 600 })
  }, [map, trace])
  return <div ref={container} style={{ position: 'absolute', inset: 0 }} />
}

const SURFACE_COLORS: Record<string, string> = { ROAD: '#4263eb', GRAVEL: '#e8590c', MTB: '#2b8a3e', MIXED: '#ae3ec9' }

/** Toutes les traces filtrées sur une même carte (affichage « carte »). */
export function AllTracesMap({ traces, onOpen }: { traces: TraceSummary[]; onOpen: (id: number) => void }) {
  const { container, map, fitTo } = useMapLibre()
  useEffect(() => {
    if (!map) return
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: traces.map((t) => line(toLngLat(t.preview), { id: t.id, name: t.name, color: SURFACE_COLORS[t.surfaceType ?? ''] ?? '#4263eb' })),
    }
    setGeoJson(map, 'all', fc)
    if (!map.getLayer('all-line')) {
      map.addLayer({ id: 'all-line', type: 'line', source: 'all', paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-opacity': 0.85 }, layout: { 'line-join': 'round' } })
      map.on('click', 'all-line', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'number') onOpen(id)
      })
      map.on('mouseenter', 'all-line', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'all-line', () => (map.getCanvas().style.cursor = ''))
    }
    const b = boundsOf(traces.flatMap((t) => toLngLat(t.preview)))
    if (b) fitTo(b, { padding: 40, duration: 0 })
  }, [map, traces, onOpen])
  return <div ref={container} style={{ position: 'absolute', inset: 0 }} />
}
