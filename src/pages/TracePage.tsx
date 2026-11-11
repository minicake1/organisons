import { useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  Code,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconArrowLeft, IconArrowsMove, IconCheck, IconChevronDown, IconDotsVertical, IconMapPinPlus, IconTrash, IconWorldSearch, IconEdit, IconFolderOpen, IconPencil } from '@tabler/icons-react'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { api, type Collection, type Poi, type PoiEdit, type PoiKind, type TraceDetail } from '../api'
import SportBadge from '../components/SportBadge'
import TagSuggestions from '../components/TagSuggestions'
import TrashButton from '../components/TrashButton'
import SendToDevice from '../components/SendToDevice'
import InboxPanel, { INBOX_EVENT, TRACE_CHANGED_EVENT } from '../components/InboxPanel'
import { HILLINESS, POI_KINDS, SURFACE_CLASSES, int, km1, poiKind, slopeColor, surfaceColor, windLabel } from '../labels'
import { computeSurface } from '../osmSurface'
import ElevationProfile from '../components/ElevationProfile'
import TraceMap from '../components/TraceMap'
import { PoiCategory } from '../components/PoiCategory'
import OsmPoiModal from '../components/OsmPoiModal'
import WindArrow from '../components/WindArrow'

export default function TracePage({
  id,
  onBack,
  backLabel = 'Bibliothèque',
  onOpen,
}: {
  id: number
  onBack: () => void
  backLabel?: string
  onOpen?: (id: number) => void
}) {
  const [t, setT] = useState<TraceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [mode, setMode] = useState<'slope' | 'surface'>('slope')
  const [mapPois, setMapPois] = useState(true)
  const [kinds, setKinds] = useState<Partial<Record<PoiKind, boolean>>>({})
  const [picks, setPicks] = useState<Record<number, boolean>>({})
  const [allTags, setAllTags] = useState<string[]>([])
  const [sports, setSports] = useState<string[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [poiOrder, setPoiOrder] = useState<'km' | 'kind'>('kind')
  const [folded, setFolded] = useState<Partial<Record<PoiKind, boolean>>>({})
  const [poiMenu, setPoiMenu] = useState<number | null>(null)
  // Mode édition des POI (écrits dans le GPX) : sélection, point à placer, formulaire.
  const [poiEditing, setPoiEditing] = useState(false)
  const [sel, setSel] = useState<number[]>([])
  const [pick, setPick] = useState<null | { mode: 'add' } | { mode: 'move'; i: number }>(null)
  const [poiForm, setPoiForm] = useState<
    null | { mode: 'add'; lat: number; lon: number; name: string; kind: PoiKind } | { mode: 'rename'; i: number; name: string }
  >(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [osmOpen, setOsmOpen] = useState(false)
  const [poiBusy, setPoiBusy] = useState(false)
  const [poiError, setPoiError] = useState<string | null>(null)
  const [canWrite, setCanWrite] = useState<boolean | null>(null)
  const [editing, setEditing] = useState(false)
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null)
  const [offline, setOffline] = useState<number[]>([])
  // Partie de la trace visible sur la carte : le profil suit le zoom.
  const [range, setRange] = useState<[number, number] | null>(null)

  // Trace remplacée par sa version gpx.studio (bandeau du dossier surveillé) : on la relit.
  useEffect(() => {
    const onChanged = (e: Event) => {
      if ((e as CustomEvent<number>).detail === id) api.getTrace(id).then(setT).catch((err) => setError(String(err)))
    }
    window.addEventListener(TRACE_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(TRACE_CHANGED_EVENT, onChanged)
  }, [id])
  const [studioNotice, setStudioNotice] = useState<string | null>(null)
  // Renommage : nom affiché, et <name> du GPX si la bibliothèque l'autorise.
  const [renaming, setRenaming] = useState<string | null>(null)
  const rename = async (name: string | null) => {
    setSaveError(null)
    try {
      const moved = await api.renameTrace(id, name)
      setRenaming(null)
      if (moved) setDeviceNotice(`Fichier renommé : ${moved}`)
    } catch (e) {
      setRenaming(null)
      setSaveError(String(e))
    }
    api.getTrace(id).then(setT).catch((e) => setError(String(e)))
  }
  const editInGpxStudio = async () => {
    setSaveError(null)
    try {
      await openUrl(await api.gpxstudioOpen(id))
      window.dispatchEvent(new Event(INBOX_EVENT))
      setStudioNotice(
        'Trace ouverte dans gpx.studio (ton navigateur). Une fois modifiée : Fichier → Exporter. Le GPX exporté arrive dans le dossier surveillé, et Organisons te propose de remplacer la trace (l’ancienne version va dans la Corbeille). Le lien vers la trace expire dans 15 minutes.',
      )
    } catch (e) {
      setSaveError(String(e))
    }
  }

  useEffect(() => {
    api.getTrace(id).then(setT).catch((e) => setError(String(e)))
    api.allTags().then(setAllTags).catch(() => {})
    api.sports().then(setSports).catch(() => {})
    api.collections().then(setCollections).catch(() => {})
    api.offlineLibraries().then(setOffline).catch(() => {})
    setPoiEditing(false)
    setSel([])
    setPick(null)
  }, [id])
  // Écriture dans le GPX autorisée par la bibliothèque de la trace (édition des POI).
  useEffect(() => {
    if (!t) return
    api
      .listLibraries()
      .then((ls) => setCanWrite(ls.find((l) => l.id === t.libraryId)?.writeGpx ?? false))
      .catch(() => setCanWrite(null))
  }, [t?.libraryId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Enregistre ; si l'écriture dans le GPX échoue, l'index est à jour et on le signale. */
  const save = (p: Promise<void>) => {
    setSaveError(null)
    p.catch((e) => setSaveError(String(e)))
  }

  const kindOn = (k: PoiKind) => kinds[k] ?? poiKind(k).byDefault
  const checked = (i: number) => picks[i] ?? (t ? kindOn(t.pois[i].kind) : false)
  const visiblePois = useMemo(() => (t && poiEditing ? t.pois : t && mapPois ? t.pois.filter((_, i) => checked(i)) : []), [t, mapPois, kinds, picks, poiEditing]) // eslint-disable-line react-hooks/exhaustive-deps
  // Couleur de chaque tronçon : pente, ou revêtement OSM (gris tant qu’il n’est pas calculé).
  const colors = useMemo(() => {
    if (!t) return []
    if (mode === "slope") return t.profile.map((p) => slopeColor(p.slopeMax))
    const runs = t.surface ?? []
    let j = 0
    return t.profile.map((p) => {
      while (j < runs.length - 1 && runs[j].toKm < p.km) j++
      return runs.length ? surfaceColor(runs[j].class) : "#ced4da"
    })
  }, [t?.profile, t?.surface, mode]) // eslint-disable-line react-hooks/exhaustive-deps
  // Légende survolée : ce type (pente ou revêtement) ressort, le reste s’efface.
  const [hl, setHl] = useState<string | null>(null)
  const shownColors = useMemo(() => (hl ? colors.map((c) => (c === hl ? c : fade(c, 0.5))) : colors), [colors, hl])
  // Sur la carte, atténuation plus légère : la trace doit rester lisible sur le fond.
  const mapColors = useMemo(() => (hl ? colors.map((c) => (c === hl ? c : fade(c, 0.45))) : colors), [colors, hl])
  const legendItem = (color: string) => ({
    onMouseEnter: () => setHl(color),
    onMouseLeave: () => setHl(null),
    style: { cursor: "default", padding: "2px 6px", margin: "-2px -6px", borderRadius: 6, background: hl === color ? "var(--mantine-color-default-hover)" : undefined },
  })
  const [surfaceBusy, setSurfaceBusy] = useState<string | null>(null)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const runSurface = () => {
    if (!t) return
    setSurfaceError(null)
    setSurfaceBusy("Lecture des tuiles OpenStreetMap…")
    computeSurface(t.id, t.profile, (done, total) => setSurfaceBusy(`Tuiles OpenStreetMap : ${done}/${total}`))
      .then((surface) => setT((cur) => (cur ? { ...cur, surface } : cur)))
      .catch((e) => setSurfaceError(String(e instanceof Error ? e.message : e)))
      .finally(() => setSurfaceBusy(null))
  }

  if (error) return <Text c="red">{error}</Text>
  if (!t) return <Loader />

  const counts = POI_KINDS.map((k) => ({ ...k, n: t.pois.filter((p) => p.kind === k.kind).length })).filter((k) => k.n > 0)
  const toggleKind = (k: PoiKind) => {
    setKinds((s) => ({ ...s, [k]: !kindOn(k) }))
    // Une catégorie remet toutes ses cases à la même valeur.
    setPicks((s) => Object.fromEntries(Object.entries(s).filter(([i]) => t.pois[Number(i)].kind !== k)))
  }
  const setAll = (v: boolean) => setPicks(Object.fromEntries(t.pois.map((_, i) => [i, v])))
  const changePoiKind = (i: number, kind: PoiKind | null) =>
    api
      .setPoiKind(t.id, i, kind)
      .then(() => api.getTrace(t.id))
      .then(setT)
      .catch((e) => setError(String(e)))
  // Modifications des POI écrites dans le GPX, puis trace relue (les indices changent).
  const runEdits = (edits: PoiEdit[]) => {
    setPoiBusy(true)
    setPoiError(null)
    return api
      .editPois(t.id, edits)
      .then(() => api.getTrace(t.id))
      .then((nt) => {
        setT(nt)
        setSel([])
        setPicks({})
      })
      .catch((e) => setPoiError(String(e)))
      .finally(() => setPoiBusy(false))
  }
  const at = (p: Poi) => ({ lat: p.lat, lon: p.lon, name: p.name })
  const placeAt = (lat: number, lon: number) => {
    if (!pick) return
    if (pick.mode === 'add') setPoiForm({ mode: 'add', lat, lon, name: '', kind: 'other' })
    else runEdits([{ op: 'move', ...at(t.pois[pick.i]), toLat: lat, toLon: lon }])
    setPick(null)
  }
  const setSelKind = async (kind: PoiKind) => {
    setPoiBusy(true)
    setPoiError(null)
    try {
      for (const i of sel) await api.setPoiKind(t.id, i, kind)
      setT(await api.getTrace(t.id))
      setSel([])
    } catch (e) {
      setPoiError(String(e))
    } finally {
      setPoiBusy(false)
    }
  }
  const editButton = (
    <Tooltip
      label="La bibliothèque de cette trace n'autorise pas la modification des GPX (Réglages → Bibliothèques)."
      disabled={canWrite !== false}
    >
      <Button
        size="compact-sm"
        variant="default"
        leftSection={<IconPencil size={14} />}
        data-disabled={canWrite === false || undefined}
        onClick={(e) => (canWrite === false ? e.preventDefault() : (setPoiEditing(true), setPoiError(null)))}
      >
        Modifier
      </Button>
    </Tooltip>
  )
  const isOn = (i: number) => (poiEditing ? sel.includes(i) : checked(i))
  const poiRow = (p: Poi, i: number) => (
    <Checkbox
      key={i}
      py={6}
      style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
      checked={isOn(i)}
      onChange={(e) => {
        const v = e.currentTarget.checked
        if (poiEditing) return setSel((s) => (v ? [...s, i] : s.filter((x) => x !== i)))
        if (v) setMapPois(true)
        setPicks((s) => ({ ...s, [i]: v }))
      }}
      label={
        <Group gap={8} wrap="nowrap">
          {/* Pastille : couleur de la catégorie, entourée quand elle est choisie ; un clic ouvre le menu. */}
          <Box
            component="button"
            aria-label="Changer la catégorie du POI"
            onClick={(e: React.MouseEvent) => {
              e.preventDefault()
              e.stopPropagation()
              setPoiMenu(i)
            }}
            w={14}
            h={14}
            p={0}
            style={{
              borderRadius: '50%',
              background: poiKind(p.kind).color,
              flex: 'none',
              cursor: 'pointer',
              border: p.kindUser ? '2px solid var(--mantine-color-text)' : '2px solid transparent',
            }}
          />
          <Text size="sm" lineClamp={1} style={{ flex: 1 }}>
            {p.name || '(sans nom)'}
          </Text>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            km {km1(p.km)}
          </Text>
          {/* ⋮ : changer la catégorie (gardée à la relecture et dans la sauvegarde). */}
          <Menu position="bottom-end" withinPortal shadow="md" opened={poiMenu === i} onChange={(o) => setPoiMenu(o ? i : null)}>
            <Menu.Target>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label="Changer la catégorie du POI"
                onClick={(e: React.MouseEvent) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              >
                <IconDotsVertical size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
              {poiEditing && (
                <>
                  <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setPoiForm({ mode: 'rename', i, name: p.name })}>
                    Renommer
                  </Menu.Item>
                  <Menu.Item leftSection={<IconArrowsMove size={14} />} onClick={() => setPick({ mode: 'move', i })}>
                    Déplacer
                  </Menu.Item>
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => {
                      setSel([i])
                      setConfirmDelete(true)
                    }}
                  >
                    Supprimer
                  </Menu.Item>
                  <Menu.Divider />
                </>
              )}
              <Menu.Label>Catégorie de « {p.name || 'sans nom'} »</Menu.Label>
              {POI_KINDS.map((k) => (
                <Menu.Item
                  key={k.kind}
                  leftSection={<Box w={10} h={10} style={{ borderRadius: '50%', background: k.color }} />}
                  rightSection={k.kind === p.kind ? <IconCheck size={14} /> : null}
                  onClick={() => changePoiKind(i, k.kind)}
                >
                  {k.label}
                </Menu.Item>
              ))}
              {p.kindUser && (
                <>
                  <Menu.Divider />
                  <Menu.Item c="dimmed" onClick={() => changePoiKind(i, null)}>
                    Revenir à la catégorie détectée
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      }
      styles={{ body: { alignItems: 'center' }, labelWrapper: { flex: 1, minWidth: 0 } }}
    />
  )

  return (
    // Hauteur de la fenêtre : carte et profil visibles ensemble, seul le panneau de droite défile.
    <Stack gap="md" h="calc(100dvh - 2 * var(--mantine-spacing-lg))" style={{ overflow: 'hidden' }}>
      <Group gap="xs">
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack} px={6}>
          {backLabel}
        </Button>
      </Group>
      <Group align="center">
        {renaming != null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              rename(renaming)
            }}
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <TextInput
              autoFocus
              size="md"
              w={420}
              value={renaming}
              onChange={(e) => setRenaming(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
              aria-label="Nouveau nom"
            />
            <Button type="submit" disabled={!renaming.trim()}>
              Renommer
            </Button>
            <Tooltip label="Reprendre le nom écrit dans le fichier GPX">
              <Button variant="subtle" color="gray" onClick={() => rename(null)}>
                Nom du fichier
              </Button>
            </Tooltip>
            <Button variant="subtle" color="gray" onClick={() => setRenaming(null)}>
              Annuler
            </Button>
          </form>
        ) : (
          <Group gap={4} wrap="nowrap">
            <Title order={2}>{t.name}</Title>
            <Tooltip label="Renommer la trace">
              <ActionIcon variant="subtle" color="gray" aria-label="Renommer la trace" onClick={() => setRenaming(t.name)}>
                <IconPencil size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
        {t.source === 'komoot' && (
          <Badge color="green" variant="light">
            Komoot
          </Badge>
        )}
        <Group gap="xs" ml="auto">
          <Tooltip label="Dossier injoignable (NAS éteint ?) : la trace reste consultable ici." disabled={!offline.includes(t.libraryId)}>
            <Button
              variant="default"
              leftSection={<IconFolderOpen size={16} />}
              disabled={offline.includes(t.libraryId)}
              onClick={() => revealItemInDir(t.path)}
            >
            Ouvrir le dossier
            </Button>
          </Tooltip>
          <Tooltip label="Modifier la trace dans gpx.studio (couper, inverser, retracer…), dans ton navigateur">
            <Button variant="default" leftSection={<IconEdit size={16} />} disabled={offline.includes(t.libraryId)} onClick={editInGpxStudio}>
              Modifier dans gpx.studio
            </Button>
          </Tooltip>
          <TrashButton look="button" trace={t} onTrashed={onBack} />
          <SendToDevice traceId={t.id} onMessage={(text, isError) => (isError ? setSaveError(text) : setDeviceNotice(text))} />
        </Group>
      </Group>

      <InboxPanel onOpen={(other) => (other === id ? undefined : onOpen?.(other))} />
      {studioNotice && (
        <Paper withBorder p="xs" bg="var(--mantine-color-indigo-light)" c="var(--mantine-color-indigo-light-color)" onClick={() => setStudioNotice(null)}>
          <Text size="sm">{studioNotice}</Text>
        </Paper>
      )}
      {deviceNotice && (
        <Paper withBorder p="xs" bg="var(--mantine-color-teal-light)" c="var(--mantine-color-teal-light-color)" onClick={() => setDeviceNotice(null)}>
          <Text size="sm">{deviceNotice}</Text>
        </Paper>
      )}
      <Group align="stretch" gap="md" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
        <Stack gap="md" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <Paper withBorder radius="md" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <Box style={{ position: 'relative', flex: 1, minHeight: 200 }}>
              <TraceMap profile={t.profile} pois={visiblePois} cursor={cursor} colors={mapColors} onView={setRange} onPick={pick ? placeAt : undefined} />
            </Box>
            <Stack gap="sm" p="md">
              <Group>
                <Text fw={600} mr="auto">
                  Profil altimétrique
                </Text>
                <SegmentedControl
                  size="xs"
                  value={mode}
                  onChange={(v) => setMode(v as 'slope' | 'surface')}
                  data={[
                    { value: 'slope', label: 'Pente' },
                    { value: 'surface', label: 'Revêtement' },
                  ]}
                />
              </Group>
              <ElevationProfile
                profile={t.profile}
                pois={visiblePois}
                cursor={cursor}
                onCursor={setCursor}
                colors={shownColors}
                range={range}
                height="clamp(130px, 20vh, 220px)"
                onPick={pick ? (i) => placeAt(t.profile[i].lat, t.profile[i].lon) : undefined}
              />
              {mode === 'slope' ? (
                <Group gap="md" wrap="wrap">
                  {[
                    ['#c0eb75', '0–3 %'],
                    ['#ffd43b', '3–6 %'],
                    ['#ff922b', '6–9 %'],
                    ['#f03e3e', '> 9 %'],
                  ].map(([c, l]) => (
                    <Group key={l} gap={6} {...legendItem(c)}>
                      <Box w={12} h={12} style={{ borderRadius: 3, background: c }} />
                      <Text size="xs">{l}</Text>
                    </Group>
                  ))}
                </Group>
              ) : (
                <Group gap="md" wrap="wrap">
                  {t.surface ? (
                    SURFACE_CLASSES.map((s) => {
                      const km = t.surface!.filter((r) => r.class === s.value).reduce((a, r) => a + r.toKm - r.fromKm, 0)
                      if (km <= 0) return null
                      return (
                        <Group key={s.value} gap={6} {...legendItem(s.color)}>
                          <Box w={12} h={12} style={{ borderRadius: 3, background: s.color }} />
                          <Text size="xs">
                            {s.label} · {km1(km)} km ({int((km / (t.distanceKm || 1)) * 100)} %)
                          </Text>
                        </Group>
                      )
                    })
                  ) : (
                    <Text size="xs" c="dimmed">
                      Le revêtement n’a pas encore été calculé pour cette trace.
                    </Text>
                  )}
                  <Button
                    size="compact-xs"
                    variant={t.surface ? 'subtle' : 'filled'}
                    ml="auto"
                    loading={surfaceBusy != null}
                    onClick={runSurface}
                  >
                    {t.surface ? 'Recalculer' : 'Calculer depuis OpenStreetMap'}
                  </Button>
                  {surfaceBusy && (
                    <Text size="xs" c="dimmed">
                      {surfaceBusy}
                    </Text>
                  )}
                  {surfaceError && (
                    <Text size="xs" c="red" w="100%">
                      {surfaceError}
                    </Text>
                  )}
                </Group>
              )}
              {counts.length > 0 && (
                <Group gap={6}>
                  <Text size="xs" fw={600} c="dimmed">
                    Points d'intérêt du GPX
                  </Text>
                  {counts.map((k) => (
                    <Chip key={k.kind} size="xs" checked={kindOn(k.kind)} onChange={() => toggleKind(k.kind)} color="dark" variant="outline">
                      {k.label} ({k.n})
                    </Chip>
                  ))}
                </Group>
              )}
              <SimpleGrid cols={5} pt="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
                <Stat value={`${km1(t.distanceKm)} km`} label="Distance" />
                <Stat value={`${int(t.elevationGain)} m`} label="Montée" />
                <Stat value={`${int(t.elevationLoss)} m`} label="Descente" />
                <Stat value={`${int(t.eleMax)} m`} label="Point culminant" />
                <Stat value={`${int(t.eleMin)} m`} label="Point le plus bas" />
              </SimpleGrid>
            </Stack>
          </Paper>
        </Stack>

        <Stack gap="md" style={{ width: 380, flexShrink: 0, overflowY: 'auto', paddingRight: 4 }}>
          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Text fw={600}>Classement</Text>
                <Button
                  size="compact-sm"
                  variant={editing ? "filled" : "default"}
                  leftSection={editing ? <IconCheck size={14} /> : <IconPencil size={14} />}
                  onClick={() => setEditing((v) => !v)}
                >
                  {editing ? "Terminé" : "Modifier"}
                </Button>
              </Group>
              {editing ? (
              <>
              <Select
                label="Sport"
                description="Sert au rangement des bibliothèques gérées. Effacer pour revenir au sport lu dans le GPX (ou dans son titre)."
                clearable
                allowDeselect={false}
                data={sports.includes(t.sport) ? sports : [...sports, t.sport]}
                value={t.sport}
                onChange={(v) => {
                  api
                    .setSport(t.id, v)
                    .then(() => (v ? setT({ ...t, sport: v }) : api.getTrace(t.id).then(setT)))
                    .catch((e) => setSaveError(String(e)))
                }}
              />
              <TagsInput
                label="Tags"
                placeholder="Ajouter un tag"
                data={allTags}
                value={t.tags}
                onChange={(tags) => {
                  setT({ ...t, tags })
                  save(api.setTags(t.id, tags))
                }}
              />
              <TagsInput
                label="Collections"
                description="Choisis une collection ou tape un nouveau nom puis Entrée pour la créer."
                placeholder="Ajouter à une collection"
                data={collections.map((c) => c.name)}
                value={t.collectionIds.map((id) => collections.find((c) => c.id === id)?.name).filter((n): n is string => !!n)}
                onChange={(names) => {
                  setSaveError(null)
                  ;(async () => {
                    const ids: number[] = []
                    let list = collections
                    for (const name of names) {
                      const found = list.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
                      if (found) ids.push(found.id)
                      else if (name.trim()) {
                        const created = await api.createCollection(name.trim())
                        list = [...list, created]
                        ids.push(created.id)
                      }
                    }
                    setCollections(list)
                    setT((cur) => (cur ? { ...cur, collectionIds: ids } : cur))
                    await api.setTraceCollections(t.id, ids)
                  })().catch((e) => setSaveError(String(e)))
                }}
              />
              <Textarea
                label="Notes"
                autosize
                minRows={3}
                defaultValue={t.notes}
                onBlur={(e) => {
                  const notes = e.currentTarget.value
                  if (notes !== t.notes) {
                    setT({ ...t, notes })
                    save(api.setNotes(t.id, notes))
                  }
                }}
              />
              {saveError && (
                <Text size="xs" c="red">
                  {saveError}
                </Text>
              )}
              </>
              ) : (
                <ClassementView t={t} collections={collections} />
              )}
              <TagSuggestions
                suggestions={t.tagSuggestions.filter((s) => !t.tags.some((x) => x.toLowerCase() === s.toLowerCase()))}
                onAdd={(add) => {
                  const tags = [...t.tags, ...add.filter((a) => !t.tags.some((x) => x.toLowerCase() === a.toLowerCase()))]
                  setT({ ...t, tags, tagSuggestions: t.tagSuggestions.filter((s) => !add.includes(s)) })
                  save(api.setTags(t.id, tags))
                }}
                onIgnore={(ign) => {
                  setT({ ...t, tagSuggestions: t.tagSuggestions.filter((s) => !ign.includes(s)) })
                  save(api.ignoreTagSuggestions(t.id, ign))
                }}
              />
              {saveError && !editing && (
                <Text size="xs" c="red">
                  {saveError}
                </Text>
              )}
              <Group gap="md">
                <Text size="sm">Relief : {HILLINESS[t.hilliness]}</Text>
                <Group gap={4} c="var(--mantine-color-blue-light-color)">
                  <WindArrow wind={t.wind} />
                  <Text size="sm" c="var(--mantine-color-blue-light-color)">
                    Vent idéal : {windLabel(t.wind)}
                  </Text>
                </Group>
              </Group>
            </Stack>
          </Paper>

          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group>
                <Text fw={600} mr="auto">
                  Points d'intérêt
                </Text>
                <Text size="xs" c="dimmed">
                  {poiEditing ? `${sel.length} sélectionné(s) / ${t.pois.length}` : `${visiblePois.length} sur la carte / ${t.pois.length}`}
                </Text>
                {poiEditing && (
                  <Button size="compact-sm" onClick={() => (setPoiEditing(false), setSel([]), setPick(null))}>
                    Terminer
                  </Button>
                )}
              </Group>
              {poiEditing && (
                <Stack gap={6}>
                  <Group gap="xs">
                    <Button
                      size="compact-sm"
                      variant={pick?.mode === 'add' ? 'filled' : 'default'}
                      leftSection={<IconMapPinPlus size={14} />}
                      onClick={() => setPick(pick?.mode === 'add' ? null : { mode: 'add' })}
                    >
                      Ajouter un POI
                    </Button>
                    <Button size="compact-sm" variant="default" leftSection={<IconWorldSearch size={14} />} onClick={() => setOsmOpen(true)}>
                      OpenStreetMap…
                    </Button>
                    <Menu position="bottom-start" withinPortal shadow="md">
                      <Menu.Target>
                        <Button size="compact-sm" variant="default" disabled={!sel.length} rightSection={<IconChevronDown size={14} />}>
                          Catégorie
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {POI_KINDS.map((k) => (
                          <Menu.Item
                            key={k.kind}
                            leftSection={<Box w={10} h={10} style={{ borderRadius: '50%', background: k.color }} />}
                            onClick={() => setSelKind(k.kind)}
                          >
                            {k.label}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                    <Button
                      size="compact-sm"
                      variant="default"
                      color="red"
                      disabled={!sel.length}
                      leftSection={<IconTrash size={14} />}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Supprimer
                    </Button>
                    {sel.length > 0 && (
                      <Button size="compact-sm" variant="subtle" color="gray" onClick={() => setSel([])}>
                        Désélectionner
                      </Button>
                    )}
                    {poiBusy && <Loader size="xs" />}
                  </Group>
                  {pick ? (
                    <Paper p="xs" bg="var(--mantine-color-indigo-light)" c="var(--mantine-color-indigo-light-color)">
                      <Group gap="xs">
                        <Text size="sm" style={{ flex: 1 }}>
                          {pick.mode === 'add'
                            ? 'Clique sur la carte (position exacte) ou sur le profil (point de la trace) pour placer le nouveau POI.'
                            : `Clique sur la carte ou le profil pour déplacer « ${t.pois[pick.i]?.name || 'sans nom'} ».`}
                        </Text>
                        <Button size="compact-xs" variant="subtle" onClick={() => setPick(null)}>
                          Annuler
                        </Button>
                      </Group>
                    </Paper>
                  ) : (
                    <Text size="xs" c="dimmed">
                      Coche des POI pour changer leur catégorie ou les supprimer ; ⋮ au bout d'une ligne pour renommer, déplacer ou supprimer.
                      Les modifications sont écrites dans le fichier GPX ; la catégorie reste dans Organisons.
                    </Text>
                  )}
                  {poiError && (
                    <Text size="sm" c="red" onClick={() => setPoiError(null)}>
                      {poiError}
                    </Text>
                  )}
                </Stack>
              )}
              {t.pois.length === 0 ? (
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                    Ce fichier ne contient pas de points d'intérêt (waypoints).
                  </Text>
                  {!poiEditing && editButton}
                </Group>
              ) : (
                <>
                  {!poiEditing && (
                    <>
                      <Group gap="xs" wrap="nowrap">
                        <Checkbox
                          label="Afficher les POI sur la carte"
                          checked={mapPois}
                          onChange={(e) => setMapPois(e.currentTarget.checked)}
                          fw={600}
                          style={{ flex: 1 }}
                        />
                        {editButton}
                      </Group>
                      <Group gap="xs">
                        <Button size="compact-xs" variant="default" onClick={() => (setMapPois(true), setAll(true))}>
                          Tout cocher
                        </Button>
                        <Button size="compact-xs" variant="default" onClick={() => setAll(false)}>
                          Tout décocher
                        </Button>
                      </Group>
                    </>
                  )}
                  <SegmentedControl
                    size="xs"
                    value={poiOrder}
                    onChange={(v) => setPoiOrder(v as 'km' | 'kind')}
                    data={[
                      { value: 'km', label: 'Par km' },
                      { value: 'kind', label: 'Par catégorie' },
                    ]}
                  />
                  {!poiEditing && (
                    <Text size="xs" c="dimmed">
                      Catégorie mal reconnue : ⋮ au bout de la ligne (ou clic sur la pastille). Pastille entourée : catégorie choisie. « Modifier »
                      pour ajouter, renommer, déplacer ou supprimer des POI.
                    </Text>
                  )}
                  {/* La liste défile seule : en-tête, outils et Classement restent visibles. */}
                  <Box style={{ maxHeight: 'max(280px, calc(100dvh - 420px))', overflowY: 'auto', overscrollBehavior: 'contain', marginRight: -6, paddingRight: 6 }}>
                    <Stack gap={0}>
                      {poiOrder === 'km'
                        ? t.pois.map((p, i) => poiRow(p, i))
                        : POI_KINDS.map((k) => {
                            const idx = t.pois.map((p, i) => (p.kind === k.kind ? i : -1)).filter((i) => i >= 0)
                            if (!idx.length) return null
                            const on = idx.filter((i) => isOn(i)).length
                            return (
                              <PoiCategory
                                key={k.kind}
                                kind={k.kind}
                                count={`${on}/${idx.length}`}
                                folded={!!folded[k.kind]}
                                onFold={() => setFolded((s) => ({ ...s, [k.kind]: !s[k.kind] }))}
                                check={{
                                  checked: on === idx.length,
                                  indeterminate: on > 0 && on < idx.length,
                                  label: poiEditing ? `Sélectionner tous les POI ${k.label}` : `Afficher tous les POI ${k.label}`,
                                  onChange: (v) => {
                                    if (poiEditing) return setSel((s) => (v ? [...new Set([...s, ...idx])] : s.filter((x) => !idx.includes(x))))
                                    if (v) setMapPois(true)
                                    setPicks((s) => ({ ...s, ...Object.fromEntries(idx.map((i) => [i, v])) }))
                                  },
                                }}
                              >
                                {idx.map((i) => poiRow(t.pois[i], i))}
                              </PoiCategory>
                            )
                          })}
                    </Stack>
                  </Box>
                </>
              )}
            </Stack>
          </Paper>

          <Paper withBorder radius="md" p="md">
            <Stack gap={8}>
              <Text fw={600}>Fichier</Text>
              <Code block style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                {t.path}
              </Code>
              {t.creator && <Text size="sm">Créé avec : {t.creator}</Text>}
              <Text size="sm">Horaires de passage : {t.hasTime ? 'oui' : 'non'}</Text>
              <Anchor size="sm" component="button" onClick={() => revealItemInDir(t.path)}>
                Afficher dans l'explorateur
              </Anchor>
            </Stack>
          </Paper>
        </Stack>
      </Group>
      <Modal
        opened={poiForm !== null}
        onClose={() => setPoiForm(null)}
        title={poiForm?.mode === 'add' ? 'Nouveau point d’intérêt' : 'Renommer le point d’intérêt'}
      >
        {poiForm && (
          <form
            onSubmit={(ev) => {
              ev.preventDefault()
              const f = poiForm
              setPoiForm(null)
              if (f.mode === 'add') runEdits([{ op: 'add', lat: f.lat, lon: f.lon, name: f.name.trim(), kind: f.kind }])
              else runEdits([{ op: 'rename', ...at(t.pois[f.i]), newName: f.name.trim() }])
            }}
          >
            <Stack gap="sm">
              <TextInput
                autoFocus
                label="Nom"
                value={poiForm.name}
                onChange={(ev) => {
                  const name = ev.currentTarget.value
                  setPoiForm((f) => (f ? { ...f, name } : f))
                }}
              />
              {poiForm.mode === 'add' && (
                <Select
                  label="Catégorie"
                  allowDeselect={false}
                  value={poiForm.kind}
                  data={POI_KINDS.map((k) => ({ value: k.kind, label: k.label }))}
                  onChange={(v) => v && setPoiForm((f) => (f && f.mode === 'add' ? { ...f, kind: v as PoiKind } : f))}
                />
              )}
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setPoiForm(null)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={!poiForm.name.trim()}>
                  {poiForm.mode === 'add' ? 'Ajouter' : 'Renommer'}
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>
      <OsmPoiModal
        traceId={t.id}
        opened={osmOpen}
        onClose={() => setOsmOpen(false)}
        onAdd={(picked) => runEdits(picked.map((c) => ({ op: 'add' as const, lat: c.lat, lon: c.lon, name: c.name, kind: c.kind })))}
      />
      <Modal opened={confirmDelete} onClose={() => setConfirmDelete(false)} title="Supprimer des points d’intérêt">
        <Stack gap="sm">
          <Text size="sm">
            {sel.length === 1 ? `« ${t.pois[sel[0]]?.name || 'sans nom'} » sera retiré` : `${sel.length} points d’intérêt seront retirés`} du fichier GPX.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmDelete(false)}>
              Annuler
            </Button>
            <Button
              color="red"
              onClick={() => {
                setConfirmDelete(false)
                runEdits(sel.map((i) => ({ op: 'delete' as const, ...at(t.pois[i]) })))
              }}
            >
              Supprimer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <Text fw={700} size="lg">
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </div>
  )
}

/** Classement en lecture seule (le bouton « Modifier » passe en édition). */
function ClassementView({ t, collections }: { t: TraceDetail; collections: Collection[] }) {
  const cols = t.collectionIds.map((id) => collections.find((c) => c.id === id)?.name).filter((n): n is string => !!n)
  const row = (label: string, value: React.ReactNode) => (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" w={96} style={{ flex: 'none' }}>
        {label}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }}>{value}</Box>
    </Group>
  )
  const none = (
    <Text size="sm" c="dimmed" fs="italic">
      Aucun
    </Text>
  )
  return (
    <Stack gap={8}>
      {row('Sport', <SportBadge sport={t.sport} />)}
      {row(
        'Tags',
        t.tags.length ? (
          <Group gap={4}>
            {t.tags.map((tag) => (
              <Badge key={tag} variant="light" color="gray" tt="none">
                {tag}
              </Badge>
            ))}
          </Group>
        ) : (
          none
        ),
      )}
      {row(
        'Collections',
        cols.length ? (
          <Group gap={4}>
            {cols.map((c) => (
              <Badge key={c} variant="light" color="blue" tt="none">
                {c}
              </Badge>
            ))}
          </Group>
        ) : (
          none
        ),
      )}
      {t.notes.trim() &&
        row(
          'Notes',
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {t.notes}
          </Text>,
        )}
    </Stack>
  )
}

/** Couleur atténuée (mélangée à du blanc, 75 % par défaut ; 50 % sur le profil, 45 % sur la carte) : les autres types restent reconnaissables. */
function fade(hex: string, amount = 0.75): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (v: number) => Math.round(v + (255 - v) * amount)
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`
}
