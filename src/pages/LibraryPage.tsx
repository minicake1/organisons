import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import {
  IconChevronDown,
  IconChevronUp,
  IconFilter,
  IconLayoutGrid,
  IconLayoutSidebar,
  IconList,
  IconMap,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react'
import { api, type Hilliness, type Library, type SortKey, type TraceFilter, type TraceSummary, type Wind } from '../api'
import { HILLINESS, SURFACES, WINDS, date, int, km1, windLabel, windShort } from '../labels'
import TrackThumb from '../components/TrackThumb'
import WindArrow from '../components/WindArrow'
import { AllTracesMap, SelectedTraceMap } from '../components/LibraryMaps'

type View = 'grid' | 'split' | 'list' | 'map'
const EMPTY: TraceFilter = { sort: 'date', ascending: false }

export default function LibraryPage({ onOpen, onSettings }: { onOpen: (id: number) => void; onSettings: () => void }) {
  const [filter, setFilter] = useState<TraceFilter>(EMPTY)
  const [traces, setTraces] = useState<TraceSummary[]>([])
  const [libraries, setLibraries] = useState<Library[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [open, setOpen] = useState(true)
  const [view, setView] = useState<View>('grid')
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.listTraces(filter).then(setTraces).catch((e) => setError(String(e)))
  }, [filter])

  useEffect(() => {
    const t = setTimeout(load, 150)
    return () => clearTimeout(t)
  }, [load])
  useEffect(() => {
    api.listLibraries().then(setLibraries).catch(() => {})
    api.allTags().then(setTags).catch(() => {})
  }, [])

  const set = <K extends keyof TraceFilter>(k: K, v: TraceFilter[K]) => setFilter((f) => ({ ...f, [k]: v ?? undefined }))
  const activeCount = useMemo(
    () =>
      [filter.query, filter.hilliness, filter.surfaceType, filter.wind, filter.source, filter.tag].filter(Boolean).length +
      (filter.distanceMin != null || filter.distanceMax != null ? 1 : 0) +
      (filter.elevationMin != null || filter.elevationMax != null ? 1 : 0),
    [filter],
  )
  const sel = traces.find((t) => t.id === selected) ?? traces[0] ?? null

  const rescan = async () => {
    setBusy(true)
    try {
      const r = await api.scanAll()
      if (r.errors.length) setError(r.errors.slice(0, 3).join('\n'))
      load()
      api.allTags().then(setTags)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!libraries.length) {
    return (
      <Stack align="center" justify="center" h="70vh" gap="sm">
        <Title order={2}>Bienvenue dans Organisons</Title>
        <Text c="dimmed">Ajoute un dossier de GPX (sur ce PC ou sur ton NAS) pour commencer.</Text>
        <Button onClick={onSettings}>Ajouter un dossier</Button>
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <Group>
        <Title order={2} mr="auto">
          Bibliothèque
        </Title>
        <Button variant="default" leftSection={<IconRefresh size={16} />} loading={busy} onClick={rescan}>
          Relire les dossiers
        </Button>
      </Group>

      {error && (
        <Paper withBorder p="sm" bg="red.0" c="red.9" style={{ whiteSpace: 'pre-line' }} onClick={() => setError(null)}>
          {error}
        </Paper>
      )}

      <Group gap="xs">
        <Button
          variant="default"
          leftSection={<IconFilter size={16} />}
          rightSection={open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Masquer les filtres' : 'Filtres'}
          {activeCount > 0 && (
            <Badge ml={8} size="sm" circle>
              {activeCount}
            </Badge>
          )}
        </Button>
        {activeCount > 0 && (
          <Button variant="subtle" onClick={() => setFilter({ ...EMPTY, sort: filter.sort, ascending: filter.ascending })}>
            Effacer
          </Button>
        )}
      </Group>

      <Collapse in={open}>
        <Paper withBorder p="md" radius="md">
          <Stack gap="md">
            <TextInput
              aria-label="Rechercher des traces"
              placeholder="Rechercher par nom, tag ou note…"
              leftSection={<IconSearch size={16} />}
              value={filter.query ?? ''}
              onChange={(e) => set('query', e.currentTarget.value)}
            />
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md" verticalSpacing="md">
              <MinMax label="Distance" unit="km" min={filter.distanceMin} max={filter.distanceMax} onMin={(v) => set('distanceMin', v)} onMax={(v) => set('distanceMax', v)} />
              <MinMax label="Dénivelé positif" unit="m" min={filter.elevationMin} max={filter.elevationMax} onMin={(v) => set('elevationMin', v)} onMax={(v) => set('elevationMax', v)} />
              <Select
                label="Relief"
                placeholder="Tous les niveaux"
                clearable
                data={[
                  { value: 'FLAT', label: 'Plat (< 8 m/km)' },
                  { value: 'HILLY', label: 'Vallonné (8–15 m/km)' },
                  { value: 'MOUNTAINOUS', label: 'Montagneux (> 15 m/km)' },
                ]}
                value={filter.hilliness ?? null}
                onChange={(v) => set('hilliness', (v as Hilliness) ?? undefined)}
              />
              <Select
                label="Type de revêtement"
                placeholder="Tous les types"
                clearable
                data={Object.entries(SURFACES).map(([value, label]) => ({ value, label }))}
                value={filter.surfaceType ?? null}
                onChange={(v) => set('surfaceType', v ?? undefined)}
              />
              <Stack gap={4}>
                <Select
                  label="Direction du vent"
                  placeholder="Toutes directions"
                  clearable
                  data={WINDS.map((w) => ({ value: w.value, label: w.label }))}
                  value={filter.wind ?? null}
                  onChange={(v) => set('wind', (v as Wind) ?? undefined)}
                />
                <Checkbox size="xs" label="Inclure les directions voisines (±45°)" checked={!!filter.windNear} onChange={(e) => set('windNear', e.currentTarget.checked)} />
              </Stack>
              <Select
                label="Source"
                placeholder="Toutes les sources"
                clearable
                data={[
                  { value: 'local', label: 'Fichiers locaux / NAS' },
                  { value: 'komoot', label: 'Komoot' },
                ]}
                value={filter.source ?? null}
                onChange={(v) => set('source', v ?? undefined)}
              />
              <Select label="Tags" placeholder="Tous les tags" clearable searchable data={tags} value={filter.tag ?? null} onChange={(v) => set('tag', v ?? undefined)} />
              <Group gap="xs" align="flex-end" wrap="nowrap">
                <Select
                  label="Trier par"
                  style={{ flex: 1 }}
                  data={[
                    { value: 'date', label: 'Date' },
                    { value: 'distance', label: 'Distance' },
                    { value: 'elevation', label: 'Dénivelé' },
                    { value: 'hilliness', label: 'Relief' },
                    { value: 'name', label: 'Nom' },
                  ]}
                  value={filter.sort ?? 'date'}
                  onChange={(v) => set('sort', (v as SortKey) ?? 'date')}
                  allowDeselect={false}
                />
                <Tooltip label={filter.ascending ? 'Croissant' : 'Décroissant'}>
                  <ActionIcon size={36} variant="default" aria-label={filter.ascending ? 'Ordre croissant' : 'Ordre décroissant'} onClick={() => set('ascending', !filter.ascending)}>
                    {filter.ascending ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  </ActionIcon>
                </Tooltip>
              </Group>
            </SimpleGrid>
          </Stack>
        </Paper>
      </Collapse>

      <Group>
        <Text c="dimmed" mr="auto">
          {traces.length} {traces.length > 1 ? 'traces' : 'trace'}
        </Text>
        <Text c="dimmed" size="sm">
          Affichage
        </Text>
        <SegmentedControl
          value={view}
          onChange={(v) => setView(v as View)}
          data={[
            { value: 'grid', label: <IconLayoutGrid size={18} aria-label="Grille" /> },
            { value: 'split', label: <IconLayoutSidebar size={18} aria-label="Liste et carte" /> },
            { value: 'list', label: <IconList size={18} aria-label="Liste" /> },
            { value: 'map', label: <IconMap size={18} aria-label="Carte" /> },
          ]}
        />
      </Group>

      {traces.length === 0 && (
        <Paper withBorder p="xl" ta="center" style={{ borderStyle: 'dashed' }}>
          <Text fw={600}>Aucune trace trouvée</Text>
          <Text c="dimmed" size="sm">
            Aucune trace ne correspond à ces filtres.
          </Text>
        </Paper>
      )}

      {traces.length > 0 && view === 'grid' && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }}>
          {traces.map((t) => (
            <Card key={t.id} withBorder padding={0} radius="md" component="button" onClick={() => onOpen(t.id)} style={{ textAlign: 'left', cursor: 'pointer' }}>
              <TrackThumb preview={t.preview} />
              <Stack gap={8} p="md">
                <Text fw={700} lineClamp={1}>
                  {t.name}
                </Text>
                <TraceFigures t={t} />
                <TraceBadges t={t} />
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}

      {traces.length > 0 && view === 'split' && (
        <Group align="stretch" gap="md" wrap="wrap">
          <Paper withBorder radius="md" style={{ flex: '1 1 380px', minWidth: 0, overflow: 'hidden' }}>
            <ScrollArea h={640}>
              {traces.map((t) => {
                const on = t.id === sel?.id
                return (
                  <UnstyledButton
                    key={t.id}
                    onClick={() => setSelected(t.id)}
                    aria-pressed={on}
                    w="100%"
                    p="md"
                    style={{ display: 'flex', gap: 14, borderBottom: '1px solid #f1f3f5', background: on ? '#f4f6ff' : undefined }}
                  >
                    <div style={{ width: 6, borderRadius: 3, background: on ? '#4263eb' : '#ced4da', flex: 'none' }} />
                    <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                      <Text fw={600} size="sm" lineClamp={1}>
                        {t.name}
                      </Text>
                      <Group gap="md">
                        <TraceFigures t={t} />
                        <Text size="xs" c="dimmed" ml="auto">
                          {date(t.addedAt)}
                        </Text>
                      </Group>
                      {t.tags.length > 0 && (
                        <Group gap={6}>
                          {t.tags.map((g) => (
                            <Badge key={g} size="xs" variant="light" color="gray">
                              {g}
                            </Badge>
                          ))}
                        </Group>
                      )}
                    </Stack>
                  </UnstyledButton>
                )
              })}
            </ScrollArea>
          </Paper>
          <Paper withBorder radius="md" style={{ flex: '2 1 520px', minHeight: 640, position: 'relative', overflow: 'hidden' }}>
            <SelectedTraceMap trace={sel} />
            {sel && (
              <Paper shadow="md" p="md" radius="md" style={{ position: 'absolute', left: 16, bottom: 16, right: 16, maxWidth: 440 }}>
                <Text fw={700}>{sel.name}</Text>
                <Group gap="md" mt={6}>
                  <TraceFigures t={sel} />
                  <Text size="sm">{HILLINESS[sel.hilliness]}</Text>
                </Group>
                <Anchor size="sm" fw={600} mt={6} component="button" onClick={() => onOpen(sel.id)}>
                  Ouvrir la fiche →
                </Anchor>
              </Paper>
            )}
          </Paper>
        </Group>
      )}

      {traces.length > 0 && view === 'list' && (
        <Paper withBorder radius="md">
          <Table.ScrollContainer minWidth={820}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nom</Table.Th>
                  <Table.Th>Distance</Table.Th>
                  <Table.Th>D+</Table.Th>
                  <Table.Th>Relief</Table.Th>
                  <Table.Th>Revêtement</Table.Th>
                  <Table.Th>Vent idéal</Table.Th>
                  <Table.Th>Tags</Table.Th>
                  <Table.Th>Ajout</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {traces.map((t) => (
                  <Table.Tr key={t.id} onClick={() => onOpen(t.id)} style={{ cursor: 'pointer' }}>
                    <Table.Td fw={600}>{t.name}</Table.Td>
                    <Table.Td>{km1(t.distanceKm)} km</Table.Td>
                    <Table.Td>{int(t.elevationGain)} m</Table.Td>
                    <Table.Td>{HILLINESS[t.hilliness]}</Table.Td>
                    <Table.Td>{t.surfaceType ? SURFACES[t.surfaceType] : '—'}</Table.Td>
                    <Table.Td c="blue.8">
                      <Group gap={4}>
                        <WindArrow wind={t.wind} />
                        {windLabel(t.wind)}
                      </Group>
                    </Table.Td>
                    <Table.Td>{t.tags.join(', ')}</Table.Td>
                    <Table.Td c="dimmed">{date(t.addedAt)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      {traces.length > 0 && view === 'map' && (
        <Paper withBorder radius="md" style={{ height: 680, position: 'relative', overflow: 'hidden' }}>
          <AllTracesMap traces={traces} onOpen={onOpen} />
        </Paper>
      )}
    </Stack>
  )
}

function MinMax(props: { label: string; unit: string; min?: number; max?: number; onMin: (v?: number) => void; onMax: (v?: number) => void }) {
  const num = (v: string | number) => (v === '' ? undefined : Number(v))
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        {props.label}{' '}
        <Text span c="dimmed" size="sm">
          ({props.unit})
        </Text>
      </Text>
      <Group gap={6} wrap="nowrap">
        <NumberInput aria-label={`${props.label} minimum`} placeholder="Min" min={0} value={props.min ?? ''} onChange={(v) => props.onMin(num(v))} />
        <Text c="dimmed">–</Text>
        <NumberInput aria-label={`${props.label} maximum`} placeholder="Max" min={0} value={props.max ?? ''} onChange={(v) => props.onMax(num(v))} />
      </Group>
    </Stack>
  )
}

function TraceFigures({ t }: { t: TraceSummary }) {
  return (
    <Group gap="md">
      <Text size="sm" c="dark.4">
        {km1(t.distanceKm)} km
      </Text>
      <Text size="sm" c="dark.4">
        ↑ {int(t.elevationGain)} m
      </Text>
      <Group gap={4} c="blue.8">
        <WindArrow wind={t.wind} />
        <Text size="sm" c="blue.8">
          Vent {windShort(t.wind)}
        </Text>
      </Group>
    </Group>
  )
}

function TraceBadges({ t }: { t: TraceSummary }) {
  return (
    <Group gap={6}>
      {t.surfaceType && (
        <Badge variant="light" color="gray">
          {SURFACES[t.surfaceType]}
        </Badge>
      )}
      <Badge variant="light" color="orange">
        {HILLINESS[t.hilliness]}
      </Badge>
      {t.source === 'komoot' && (
        <Badge variant="light" color="green">
          Komoot
        </Badge>
      )}
      {t.poiCount > 0 && (
        <Badge variant="light" color="indigo">
          {t.poiCount} POI
        </Badge>
      )}
    </Group>
  )
}
