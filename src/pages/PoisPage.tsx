import { useEffect, useMemo, useRef, useState } from 'react'
import { Chip, Group, Loader, Paper, Select, Stack, Switch, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import * as maplibregl from 'maplibre-gl'
import { api, type PoiKind, type PoiPlace } from '../api'
import { POI_KINDS, km1, poiKind } from '../labels'
import { boundsOf, setGeoJson, useMapLibre } from '../components/useMapLibre'
import { PoiCategory, PoiDot, poiMarker, poiTip, showPoiTip } from '../components/PoiCategory'

/** Au-delà, la liste est tronquée (la carte montre tout) : affiner la recherche. */
const LIST_MAX = 300

type Sort = 'traces' | 'name' | 'kind' | 'trace'
const byName = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })
const SORTS: Record<Sort, (a: PoiPlace, b: PoiPlace) => number> = {
  traces: (a, b) => b.traces.length - a.traces.length || byName(a.name, b.name),
  name: (a, b) => byName(a.name || '~', b.name || '~'),
  kind: (a, b) =>
    POI_KINDS.findIndex((k) => k.kind === a.kind) - POI_KINDS.findIndex((k) => k.kind === b.kind) || byName(a.name, b.name),
  trace: (a, b) => byName(a.traces[0]?.traceName ?? '', b.traces[0]?.traceName ?? '') || (a.traces[0]?.km ?? 0) - (b.traces[0]?.km ?? 0),
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const placeMeta = (p: PoiPlace) => (p.traces.length > 1 ? `${p.traces.length} traces` : (p.traces[0]?.traceName ?? ''))

/**
 * Onglet POI : les points d'intérêt de toutes les traces, regroupés par lieu
 * (même endroit, même nom), sur une carte et en liste, avec les traces qui y
 * passent. Même présentation que sur la fiche d'une trace (catégories, repères).
 */
export default function PoisPage({ onOpen }: { onOpen: (id: number) => void }) {
  const [places, setPlaces] = useState<PoiPlace[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kinds, setKinds] = useState<PoiKind[]>([])
  const [query, setQuery] = useState('')
  const [shared, setShared] = useState(false)
  const [sort, setSort] = useState<Sort>('kind')
  const [folded, setFolded] = useState<Partial<Record<PoiKind, boolean>>>({})
  const [selected, setSelected] = useState<PoiPlace | null>(null)

  useEffect(() => {
    api
      .poiPlaces()
      .then(setPlaces)
      .catch((e) => setError(String(e)))
  }, [])

  const counts = useMemo(() => {
    const c = new Map<PoiKind, number>()
    for (const p of places ?? []) c.set(p.kind, (c.get(p.kind) ?? 0) + 1)
    return c
  }, [places])

  const visible = useMemo(() => {
    const q = fold(query.trim())
    return (places ?? [])
      .filter((p) => (!kinds.length || kinds.includes(p.kind)) && (!shared || p.traces.length > 1))
      .filter((p) => !q || fold(p.name).includes(q) || p.traces.some((t) => fold(t.traceName).includes(q) || fold(t.name).includes(q)))
      .sort(SORTS[sort])
  }, [places, kinds, query, shared, sort])

  if (error) return <Text c="red">{error}</Text>
  if (!places) return <Loader />

  const shownList = visible.slice(0, LIST_MAX)
  // Ligne d'un lieu, comme une ligne de POI de la fiche.
  const row = (p: PoiPlace, i: number) => (
    <UnstyledButton
      key={`${p.lat},${p.lon},${i}`}
      onClick={() => setSelected(p)}
      px={8}
      py={6}
      w="100%"
      style={{
        borderBottom: '1px solid var(--mantine-color-default-border)',
        background: selected === p ? 'var(--mantine-color-default-hover)' : undefined,
      }}
    >
      <Group gap={8} wrap="nowrap">
        <PoiDot kind={p.kind} />
        <Text size="sm" lineClamp={1} style={{ flex: 1 }}>
          {p.name || '(sans nom)'}
        </Text>
        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }} maw={150} truncate>
          {placeMeta(p)}
        </Text>
      </Group>
    </UnstyledButton>
  )

  return (
    <Stack gap="md" h="calc(100dvh - 2 * var(--mantine-spacing-lg))" style={{ overflow: 'hidden' }}>
      <Group>
        <Title order={2}>Points d'intérêt</Title>
      </Group>
      <Group gap="sm">
        <TextInput
          placeholder="Rechercher un POI ou une trace…"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          style={{ flex: 1, maxWidth: 360 }}
        />
        <Select
          w={230}
          aria-label="Trier par"
          allowDeselect={false}
          value={sort}
          onChange={(v) => setSort((v as Sort) ?? 'kind')}
          data={[
            { value: 'kind', label: 'Trier par catégorie' },
            { value: 'traces', label: 'Trier par nombre de traces' },
            { value: 'name', label: 'Trier par nom' },
            { value: 'trace', label: 'Trier par trace (puis km)' },
          ]}
        />
        <Switch label="Sur plusieurs traces" checked={shared} onChange={(e) => setShared(e.currentTarget.checked)} />
      </Group>
      {/* Mêmes puces que sous le profil de la fiche. */}
      <Chip.Group multiple value={kinds} onChange={(v) => setKinds(v as PoiKind[])}>
        <Group gap={6}>
          {POI_KINDS.filter((k) => counts.get(k.kind)).map((k) => (
            <Chip key={k.kind} value={k.kind} size="xs" color="dark" variant="outline">
              {k.label} ({counts.get(k.kind)})
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      {places.length === 0 ? (
        <Paper withBorder p="xl" ta="center" style={{ borderStyle: 'dashed' }}>
          <Text fw={600}>Aucun point d'intérêt</Text>
          <Text c="dimmed" size="sm">
            Les POI des traces (waypoints des GPX) apparaissent ici, regroupés quand plusieurs traces passent au même endroit.
          </Text>
        </Paper>
      ) : (
        <Group align="stretch" gap="md" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
          <Paper withBorder radius="md" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <PlacesMap places={visible} selected={selected} onSelect={setSelected} />
          </Paper>
          <Stack gap="sm" style={{ width: 380, flexShrink: 0, minHeight: 0 }}>
            {selected && (
              <Paper withBorder radius="md" p="sm">
                <Group gap={8} wrap="nowrap">
                  <PoiDot kind={selected.kind} size={12} />
                  <Text fw={700} style={{ flex: 1 }} lineClamp={2}>
                    {selected.name || '(sans nom)'}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {poiKind(selected.kind).label}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed" mt={4} mb={4}>
                  Sur {selected.traces.length} trace(s) :
                </Text>
                <Stack gap={2} mah={220} style={{ overflowY: 'auto' }}>
                  {selected.traces.map((t) => (
                    <UnstyledButton key={t.traceId} onClick={() => onOpen(t.traceId)}>
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm" c="var(--mantine-color-anchor)" style={{ flex: 1 }} lineClamp={1}>
                          {t.traceName}
                        </Text>
                        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                          km {km1(t.km)}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  ))}
                </Stack>
              </Paper>
            )}
            {/* Pas de marge en haut du cadre qui défile : sinon les lignes passent au-dessus du bandeau collé. */}
            <Paper
              withBorder
              radius="md"
              px="md"
              pb="md"
              pt={sort === 'kind' ? 0 : 'md'}
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}
            >
              {sort === 'kind'
                ? POI_KINDS.map((k) => {
                    const items = shownList.filter((p) => p.kind === k.kind)
                    if (!items.length) return null
                    return (
                      <PoiCategory
                        key={k.kind}
                        kind={k.kind}
                        count={String(visible.filter((p) => p.kind === k.kind).length)}
                        folded={!!folded[k.kind]}
                        onFold={() => setFolded((f) => ({ ...f, [k.kind]: !f[k.kind] }))}
                      >
                        {items.map(row)}
                      </PoiCategory>
                    )
                  })
                : shownList.map(row)}
              {visible.length > LIST_MAX && (
                <Text size="xs" c="dimmed" p="sm">
                  … et {visible.length - LIST_MAX} autres, tous sur la carte : affine la recherche ou les catégories.
                </Text>
              )}
            </Paper>
          </Stack>
        </Group>
      )}
    </Stack>
  )
}

/**
 * Lieux sur la carte, comme sur la fiche d'une trace : contrôles et points
 * d'attention en épingle avec leur nom, les autres en pastille (couche GeoJSON,
 * rapide avec des milliers de POI, même allure que `.poi-small`).
 */
function PlacesMap({ places, selected, onSelect }: { places: PoiPlace[]; selected: PoiPlace | null; onSelect: (p: PoiPlace) => void }) {
  const { container, map, fitTo } = useMapLibre()
  const current = useRef(places)
  current.current = places
  const fitted = useRef(false)
  const pins = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!map) return
    const tip = poiTip()
    pins.current.forEach((m) => m.remove())
    pins.current = places.filter((p) => poiKind(p.kind).big).map((p) => poiMarker(map, tip, p, placeMeta(p), () => onSelect(p)))
    setGeoJson(map, 'places', {
      type: 'FeatureCollection',
      features: places.flatMap((p, i) =>
        poiKind(p.kind).big
          ? []
          : [{ type: 'Feature' as const, properties: { i, color: poiKind(p.kind).color }, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } }],
      ),
    })
    if (!map.getLayer('places')) {
      map.addLayer({
        id: 'places',
        type: 'circle',
        source: 'places',
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      })
    }
    const at = (e: maplibregl.MapLayerMouseEvent) => {
      const i = e.features?.[0]?.properties?.i
      return typeof i === 'number' ? current.current[i] : undefined
    }
    const click = (e: maplibregl.MapLayerMouseEvent) => {
      const p = at(e)
      if (p) onSelect(p)
    }
    const move = (e: maplibregl.MapLayerMouseEvent) => {
      const p = at(e)
      if (!p) return
      map.getCanvas().style.cursor = 'pointer'
      showPoiTip(map, tip, p, placeMeta(p))
    }
    const leave = () => {
      map.getCanvas().style.cursor = ''
      tip.remove()
    }
    map.on('click', 'places', click)
    map.on('mousemove', 'places', move)
    map.on('mouseleave', 'places', leave)
    if (!fitted.current && places.length) {
      const b = boundsOf(places.map((p) => [p.lon, p.lat] as [number, number]))
      if (b) fitTo(b, { padding: 40, duration: 0, maxZoom: 13 })
      fitted.current = true
    }
    return () => {
      map.off('click', 'places', click)
      map.off('mousemove', 'places', move)
      map.off('mouseleave', 'places', leave)
      tip.remove()
    }
  }, [map, places, onSelect, fitTo])

  // Noms des épingles masqués sur une vue d'ensemble, affichés en zoomant (comme sur la fiche).
  useEffect(() => {
    if (!map) return
    const update = () => map.getContainer().classList.toggle('poi-labels-off', map.getZoom() < 11)
    update()
    map.on('zoom', update)
    return () => {
      map.off('zoom', update)
    }
  }, [map])

  // Lieu choisi : entouré, et la carte s'y rend.
  useEffect(() => {
    if (!map || !map.getLayer('places')) return
    setGeoJson(map, 'place-sel', {
      type: 'FeatureCollection',
      features: selected ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [selected.lon, selected.lat] } }] : [],
    })
    if (!map.getLayer('place-sel')) {
      map.addLayer({
        id: 'place-sel',
        type: 'circle',
        source: 'place-sel',
        paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#212529', 'circle-stroke-width': 3 },
      })
    }
    if (selected) map.easeTo({ center: [selected.lon, selected.lat], zoom: Math.max(map.getZoom(), 12), duration: 500 })
  }, [map, selected])

  return <div ref={container} style={{ position: 'absolute', inset: 0 }} />
}
