import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Code,
  Collapse,
  Group,
  Modal,
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
  IconTrash,
  IconChevronUp,
  IconFileImport,
  IconFilter,
  IconLayoutGrid,
  IconLayoutSidebar,
  IconList,
  IconArrowLeft,
  IconDeviceWatch,
  IconMap,
  IconPencil,
  IconSquareCheck,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react'
import { api, type Collection, type Hilliness, type Library, type SortKey, type TraceFilter, type TraceSummary, type Wind } from '../api'
import { HILLINESS, WINDS, date, int, km1, windLabel, windShort } from '../labels'
import SportBadge from '../components/SportBadge'
import TrashButton from '../components/TrashButton'
import BatchEditModal from '../components/BatchEditModal'
import { sendToKaroo } from '../sendToKaroo'
import TrackThumb from '../components/TrackThumb'
import ManagedActions from '../components/ManagedActions'
import WindArrow from '../components/WindArrow'
import { AllTracesMap, SelectedTraceMap } from '../components/LibraryMaps'

type View = 'grid' | 'split' | 'list' | 'map'
const EMPTY: TraceFilter = { sort: 'date', ascending: false }

export default function LibraryPage({
  onOpen,
  onSettings,
  initialFilter,
  onBack,
}: {
  onOpen: (id: number) => void
  onSettings: () => void
  /** Filtre de départ (ouverture depuis l'écran Tags ou Collections). */
  initialFilter?: TraceFilter
  /** Vue d’une collection (onglet Collections) : titre de la collection et retour. */
  onBack?: () => void
}) {
  const [filter, setFilter] = useState<TraceFilter>({ ...EMPTY, ...initialFilter })
  const [collections, setCollections] = useState<Collection[]>([])
  const [traces, setTraces] = useState<TraceSummary[]>([])
  const [libraries, setLibraries] = useState<Library[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [sports, setSports] = useState<string[]>([])
  useEffect(() => {
    api.sports().then(setSports).catch(() => {})
  }, [])
  const [open, setOpen] = useState(true)
  const [view, setView] = useState<View>('grid')
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Sélection pour modifier plusieurs traces à la fois.
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [batchOpen, setBatchOpen] = useState(false)
  // Suppression par lot : confirmation, puis avancement « n / total ».
  const [trashAsk, setTrashAsk] = useState(false)
  const [trashBusy, setTrashBusy] = useState<string | null>(null)
  // Compte Hammerhead connecté : envoi de la sélection vers le Karoo.
  const [karoo, setKaroo] = useState(false)
  const [karooBusy, setKarooBusy] = useState<string | null>(null)
  useEffect(() => {
    api.hammerheadStatus().then((s) => setKaroo(s.connected)).catch(() => {})
  }, [])
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  // Bibliothèques injoignables (NAS éteint) : consultation seule.
  const [offline, setOffline] = useState<number[]>([])
  const checkOffline = () => api.offlineLibraries().then(setOffline).catch(() => {})

  const load = useCallback(() => {
    api.listTraces(filter).then(setTraces).catch((e) => setError(String(e)))
  }, [filter])

  useEffect(() => {
    const t = setTimeout(load, 150)
    return () => clearTimeout(t)
  }, [load])
  useEffect(() => {
    api.listLibraries().then(setLibraries).catch(() => {})
    checkOffline()
    api.allTags().then(setTags).catch(() => {})
    api.collections().then(setCollections).catch(() => {})
  }, [])

  const set = <K extends keyof TraceFilter>(k: K, v: TraceFilter[K]) => setFilter((f) => ({ ...f, [k]: v ?? undefined }))
  const activeCount = useMemo(
    () =>
      [filter.query, filter.hilliness, filter.sport, filter.wind, filter.source, filter.tag, filter.collection].filter(Boolean).length +
      (filter.distanceMin != null || filter.distanceMax != null ? 1 : 0) +
      (filter.elevationMin != null || filter.elevationMax != null ? 1 : 0),
    [filter],
  )
  const sel = traces.find((t) => t.id === selected) ?? traces[0] ?? null
  // Sélection limitée aux traces affichées : un filtre change, les traces masquées ne sont plus concernées.
  const shown = useMemo(() => traces.filter((t) => picked.includes(t.id)), [traces, picked])

  const rescan = async () => {
    setBusy(true)
    try {
      const r = await api.scanAll()
      if (r.errors.length) setError(r.errors.slice(0, 3).join('\n'))
      load()
      checkOffline()
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
        {onBack ? (
          <Group gap="xs" mr="auto">
            <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack} px={6}>
              Collections
            </Button>
            <Title order={2}>{collections.find((c) => c.id === filter.collection)?.name ?? 'Collection'}</Title>
          </Group>
        ) : (
          <Title order={2} mr="auto">
            Bibliothèque
          </Title>
        )}
        {libraries.some((l) => l.mode === 'managed') ? (
          <ManagedActions
            libraries={libraries.filter((l) => !offline.includes(l.id))}
            onDone={(lib, r) => {
              setNotice(`${lib.name} : ${r.text}`)
              if (r.errors.length) setError(r.errors.slice(0, 5).join('\n'))
              load()
            }}
          />
        ) : (
          <Tooltip label="L'import et le rangement se font dans une bibliothèque gérée : crée-en une dans Réglages.">
            <Button variant="default" leftSection={<IconFileImport size={16} />} onClick={onSettings}>
              Importer des GPX…
            </Button>
          </Tooltip>
        )}
        <Button variant="default" leftSection={<IconRefresh size={16} />} loading={busy} onClick={rescan}>
          Relire les dossiers
        </Button>
      </Group>

      {offline.length > 0 && (
        <Paper withBorder p="sm" bg="var(--mantine-color-yellow-light)" c="var(--mantine-color-yellow-light-color)">
          {libraries
            .filter((l) => offline.includes(l.id))
            .map((l) => l.name)
            .join(", ")}{" "}
          : dossier injoignable (NAS éteint ou hors réseau ?). Les traces restent consultables (carte, profil, tags) ; l’import, le rangement
          et l’ouverture des fichiers reviendront quand il sera accessible.
        </Paper>
      )}

      {notice && (
        <Paper withBorder p="sm" bg="var(--mantine-color-teal-light)" c="var(--mantine-color-teal-light-color)" onClick={() => setNotice(null)}>
          {notice}
        </Paper>
      )}

      {error && (
        <Paper withBorder p="sm" bg="var(--mantine-color-red-light)" c="var(--mantine-color-red-light-color)" style={{ whiteSpace: 'pre-line' }} onClick={() => setError(null)}>
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
        <Button
          ml="auto"
          variant={selecting ? 'filled' : 'default'}
          leftSection={<IconSquareCheck size={16} />}
          onClick={() => {
            setSelecting((s) => !s)
            setPicked([])
          }}
        >
          {selecting ? 'Terminer la sélection' : 'Sélectionner'}
        </Button>
      </Group>

      {selecting && (
        <Paper withBorder p="xs" radius="md" bg="var(--mantine-color-blue-light)" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
          <Group gap="sm">
            <Text size="sm" fw={600}>
              {shown.length} trace(s) sélectionnée(s)
            </Text>
            <Button size="compact-sm" variant="subtle" onClick={() => setPicked(traces.map((t) => t.id))}>
              Tout sélectionner ({traces.length})
            </Button>
            <Button size="compact-sm" variant="subtle" onClick={() => setPicked([])} disabled={!picked.length}>
              Aucune
            </Button>
            {karoo && (
              <Button
                size="compact-sm"
                ml="auto"
                variant="light"
                leftSection={<IconDeviceWatch size={14} />}
                disabled={!shown.length || karooBusy != null}
                loading={karooBusy != null}
                onClick={async () => {
                  setKarooBusy("…")
                  try {
                    const { text, report } = await sendToKaroo(shown.map((t) => t.id), (d, n) => setKarooBusy(`${d} / ${n}`))
                    setNotice(text)
                    if (report.errors.length) setError(report.errors.slice(0, 5).join(" / "))
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setKarooBusy(null)
                  }
                }}
              >
                Envoyer vers le Karoo{karooBusy ? ` (${karooBusy})` : ""}
              </Button>
            )}
            <Button size="compact-sm" ml={karoo ? undefined : "auto"} leftSection={<IconPencil size={14} />} disabled={!shown.length} onClick={() => setBatchOpen(true)}>
              Modifier tags, sport, collections…
            </Button>
            <Button
              size="compact-sm"
              color="red"
              variant="light"
              leftSection={<IconTrash size={14} />}
              disabled={!shown.length || trashBusy != null}
              loading={trashBusy != null}
              onClick={() => setTrashAsk(true)}
            >
              Supprimer{trashBusy ? ` (${trashBusy})` : ''}
            </Button>
          </Group>
        </Paper>
      )}
      <Modal opened={trashAsk} onClose={() => setTrashAsk(false)} title="Supprimer les traces sélectionnées">
        <Stack gap="sm">
          <Text size="sm">
            {shown.length === 1 ? `« ${shown[0].name} » part` : `Ces ${shown.length} traces partent`} dans la corbeille d’Organisons : les GPX sont
            déplacés dans le dossier caché <Code>.organisons-corbeille</Code> de leur bibliothèque, récupérables depuis l’onglet Corbeille jusqu’au
            vidage.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setTrashAsk(false)}>
              Annuler
            </Button>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={async () => {
                setTrashAsk(false)
                const ids = shown.map((t) => t.id)
                const errors: string[] = []
                let done = 0
                for (const id of ids) {
                  setTrashBusy(`${done} / ${ids.length}`)
                  try {
                    await api.trashTrace(id)
                    done++
                  } catch (e) {
                    errors.push(String(e))
                  }
                }
                setTrashBusy(null)
                setPicked([])
                setNotice(`${done} trace(s) mise(s) à la corbeille.`)
                if (errors.length) setError(`${errors.length} trace(s) non supprimée(s) : ${errors.slice(0, 3).join(' / ')}`)
                window.dispatchEvent(new Event('organisons:corbeille'))
                load()
              }}
            >
              Mettre {shown.length} trace(s) à la corbeille
            </Button>
          </Group>
        </Stack>
      </Modal>
      <BatchEditModal
        opened={batchOpen}
        traces={shown}
        onClose={() => setBatchOpen(false)}
        onDone={(message, warnings) => {
          setBatchOpen(false)
          setNotice(message)
          if (warnings.length) setError(`Index à jour, mais ${warnings.length} GPX non réécrit(s) :\n${warnings.slice(0, 3).join('\n')}`)
          load()
          api.allTags().then(setTags).catch(() => {})
          api.collections().then(setCollections).catch(() => {})
        }}
      />

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
                label="Sport"
                placeholder="Tous les sports"
                clearable
                data={sports}
                value={filter.sport ?? null}
                onChange={(v) => set('sport', v ?? undefined)}
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
              {collections.length > 0 && (
                <Select
                  label="Collection"
                  placeholder="Toutes les collections"
                  clearable
                  searchable
                  data={collections.map((c) => ({ value: String(c.id), label: c.name }))}
                  value={filter.collection != null ? String(filter.collection) : null}
                  onChange={(v) => set('collection', v ? Number(v) : undefined)}
                />
              )}
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
                    { value: 'sport', label: 'Sport' },
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
        <Box className="tile-grid">
          {traces.map((t) => (
            <Card
              key={t.id}
              withBorder
              padding={0}
              radius="md"
              role="button"
              tabIndex={0}
              onClick={() => (selecting ? toggle(t.id) : onOpen(t.id))}
              onKeyDown={(e) => e.key === 'Enter' && (selecting ? toggle(t.id) : onOpen(t.id))}
              style={{ textAlign: 'left', cursor: 'pointer', outline: picked.includes(t.id) ? '2px solid #4263eb' : undefined }}
            >
              <Box style={{ position: "relative" }}>
                <TrackThumb id={t.id} preview={t.preview} />
                {selecting ? (
                  <Checkbox
                    aria-label={`Sélectionner ${t.name}`}
                    checked={picked.includes(t.id)}
                    readOnly
                    size="md"
                    style={{ position: "absolute", top: 8, left: 8, pointerEvents: "none" }}
                  />
                ) : (
                  <TrashButton look="cross" trace={t} onTrashed={load} style={{ position: "absolute", top: 8, right: 8 }} />
                )}
              </Box>
              <Stack gap={8} p="md">
                <Text fw={700} lineClamp={1}>
                  {t.name}
                </Text>
                <TraceFigures t={t} />
                <TraceBadges t={t} />
              </Stack>
            </Card>
          ))}
        </Box>
      )}
      {traces.length > 0 && view === 'grid' && (
        <Text size="xs" c="dimmed" ta="right">
          Fonds de carte © OpenFreeMap, données © contributeurs OpenStreetMap
        </Text>
      )}

      {traces.length > 0 && view === 'split' && (
        <Group align="stretch" gap="md" wrap="wrap">
          <Paper withBorder radius="md" style={{ flex: '1 1 380px', minWidth: 0, overflow: 'hidden' }}>
            <ScrollArea h={640}>
              {traces.map((t) => {
                const on = t.id === sel?.id
                return (
                  <UnstyledButton
                    component="div"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && (selecting ? toggle(t.id) : setSelected(t.id))}
                    key={t.id}
                    onClick={() => (selecting ? toggle(t.id) : setSelected(t.id))}
                    aria-pressed={on}
                    w="100%"
                    p="md"
                    style={{ display: 'flex', gap: 14, borderBottom: '1px solid var(--mantine-color-default-border)', background: on ? 'var(--mantine-color-indigo-light)' : undefined }}
                  >
                    {selecting && <Checkbox aria-label={`Sélectionner ${t.name}`} checked={picked.includes(t.id)} readOnly style={{ alignSelf: "center", pointerEvents: "none" }} />}
                    <div style={{ width: 6, borderRadius: 3, background: on ? '#4263eb' : 'var(--mantine-color-default-border)', flex: 'none' }} />
                    <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={8} wrap="nowrap">
                        <SportBadge sport={t.sport} size="xs" style={{ flex: "none" }} />
                        <Text fw={600} size="sm" lineClamp={1}>
                        {t.name}
                        </Text>
                      </Group>
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
                    <TrashButton
                      trace={t}
                      onTrashed={() => {
                        setSelected(null)
                        load()
                      }}
                      style={{ alignSelf: "center", flex: "none" }}
                    />
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
                  {selecting && (
                    <Table.Th w={40}>
                      <Checkbox
                        aria-label="Tout sélectionner"
                        checked={traces.length > 0 && traces.every((t) => picked.includes(t.id))}
                        indeterminate={shown.length > 0 && !traces.every((t) => picked.includes(t.id))}
                        onChange={(e) => setPicked(e.currentTarget.checked ? traces.map((t) => t.id) : [])}
                      />
                    </Table.Th>
                  )}
                  <Table.Th>Nom</Table.Th>
                  <Table.Th>Distance</Table.Th>
                  <Table.Th>D+</Table.Th>
                  <Table.Th>Relief</Table.Th>
                  <Table.Th>Sport</Table.Th>
                  <Table.Th>Vent idéal</Table.Th>
                  <Table.Th>Tags</Table.Th>
                  <Table.Th>Ajout</Table.Th>
                  <Table.Th w={40} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {traces.map((t) => (
                  <Table.Tr
                    key={t.id}
                    onClick={() => (selecting ? toggle(t.id) : onOpen(t.id))}
                    style={{ cursor: 'pointer' }}
                    bg={picked.includes(t.id) ? 'blue.0' : undefined}
                  >
                    {selecting && (
                      <Table.Td>
                        <Checkbox aria-label={`Sélectionner ${t.name}`} checked={picked.includes(t.id)} readOnly style={{ pointerEvents: 'none' }} />
                      </Table.Td>
                    )}
                    <Table.Td fw={600}>{t.name}</Table.Td>
                    <Table.Td>{km1(t.distanceKm)} km</Table.Td>
                    <Table.Td>{int(t.elevationGain)} m</Table.Td>
                    <Table.Td>{HILLINESS[t.hilliness]}</Table.Td>
                    <Table.Td>
                      <SportBadge sport={t.sport} size="sm" />
                    </Table.Td>
                    <Table.Td c="var(--mantine-color-blue-light-color)">
                      <Group gap={4}>
                        <WindArrow wind={t.wind} />
                        {windLabel(t.wind)}
                      </Group>
                    </Table.Td>
                    <Table.Td>{t.tags.join(', ')}</Table.Td>
                    <Table.Td c="dimmed">{date(t.addedAt)}</Table.Td>
                    <Table.Td>
                      <TrashButton trace={t} onTrashed={load} />
                    </Table.Td>
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
      <Text size="sm" c="dimmed">
        {km1(t.distanceKm)} km
      </Text>
      <Text size="sm" c="dimmed">
        ↑ {int(t.elevationGain)} m
      </Text>
      <Group gap={4} c="var(--mantine-color-blue-light-color)">
        <WindArrow wind={t.wind} />
        <Text size="sm" c="var(--mantine-color-blue-light-color)">
          Vent {windShort(t.wind)}
        </Text>
      </Group>
    </Group>
  )
}

function TraceBadges({ t, sport = true }: { t: TraceSummary; sport?: boolean }) {
  return (
    <Group gap={6}>
      {sport && <SportBadge sport={t.sport} />}
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
