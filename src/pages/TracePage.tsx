import { useEffect, useMemo, useState } from 'react'
import {
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  Code,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconArrowLeft, IconDeviceWatch, IconFolderOpen } from '@tabler/icons-react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { api, type Collection, type Poi, type PoiKind, type TraceDetail } from '../api'
import { HILLINESS, POI_KINDS, SURFACES, int, km1, poiKind, windLabel } from '../labels'
import ElevationProfile from '../components/ElevationProfile'
import TraceMap from '../components/TraceMap'
import WindArrow from '../components/WindArrow'

export default function TracePage({ id, onBack, backLabel = 'Bibliothèque' }: { id: number; onBack: () => void; backLabel?: string }) {
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

  useEffect(() => {
    api.getTrace(id).then(setT).catch((e) => setError(String(e)))
    api.allTags().then(setAllTags).catch(() => {})
    api.sports().then(setSports).catch(() => {})
    api.collections().then(setCollections).catch(() => {})
  }, [id])

  /** Enregistre ; si l'écriture dans le GPX échoue, l'index est à jour et on le signale. */
  const save = (p: Promise<void>) => {
    setSaveError(null)
    p.catch((e) => setSaveError(String(e)))
  }

  const kindOn = (k: PoiKind) => kinds[k] ?? poiKind(k).byDefault
  const checked = (i: number) => picks[i] ?? (t ? kindOn(t.pois[i].kind) : false)
  const visiblePois = useMemo(() => (t && mapPois ? t.pois.filter((_, i) => checked(i)) : []), [t, mapPois, kinds, picks]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Text c="red">{error}</Text>
  if (!t) return <Loader />

  const counts = POI_KINDS.map((k) => ({ ...k, n: t.pois.filter((p) => p.kind === k.kind).length })).filter((k) => k.n > 0)
  const toggleKind = (k: PoiKind) => {
    setKinds((s) => ({ ...s, [k]: !kindOn(k) }))
    // Une catégorie remet toutes ses cases à la même valeur.
    setPicks((s) => Object.fromEntries(Object.entries(s).filter(([i]) => t.pois[Number(i)].kind !== k)))
  }
  const setAll = (v: boolean) => setPicks(Object.fromEntries(t.pois.map((_, i) => [i, v])))
  const poiRow = (p: Poi, i: number) => (
    <Checkbox
      key={i}
      py={6}
      style={{ borderBottom: '1px solid #f1f3f5' }}
      checked={checked(i)}
      onChange={(e) => {
        const v = e.currentTarget.checked
        if (v) setMapPois(true)
        setPicks((s) => ({ ...s, [i]: v }))
      }}
      label={
        <Group gap={8} wrap="nowrap">
          <Box w={10} h={10} style={{ borderRadius: '50%', background: poiKind(p.kind).color, flex: 'none' }} />
          <Text size="sm" lineClamp={1} style={{ flex: 1 }}>
            {p.name || '(sans nom)'}
          </Text>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            km {km1(p.km)}
          </Text>
        </Group>
      }
      styles={{ body: { alignItems: 'center' }, labelWrapper: { flex: 1, minWidth: 0 } }}
    />
  )

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack} px={6}>
          {backLabel}
        </Button>
      </Group>
      <Group align="center">
        <Title order={2}>{t.name}</Title>
        {t.source === 'komoot' && (
          <Badge color="green" variant="light">
            Komoot
          </Badge>
        )}
        <Group gap="xs" ml="auto">
          <Button variant="default" leftSection={<IconFolderOpen size={16} />} onClick={() => revealItemInDir(t.path)}>
            Ouvrir le dossier
          </Button>
          <Tooltip label="Prévu dans une prochaine version (Garmin, Hammerhead, Wahoo, Edge en USB)">
            <Button variant="default" leftSection={<IconDeviceWatch size={16} />} data-disabled onClick={(e) => e.preventDefault()}>
              Envoyer vers l'appareil
            </Button>
          </Tooltip>
        </Group>
      </Group>

      <Group align="flex-start" gap="md" wrap="wrap">
        <Stack gap="md" style={{ flex: '2 1 560px', minWidth: 0 }}>
          <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
            <Box style={{ position: 'relative', aspectRatio: '800 / 420' }}>
              <TraceMap profile={t.profile} pois={visiblePois} cursor={cursor} colorBySlope={mode === 'slope'} />
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
                    { value: 'surface', label: 'Revêtement', disabled: true },
                  ]}
                />
              </Group>
              <ElevationProfile profile={t.profile} pois={visiblePois} cursor={cursor} onCursor={setCursor} />
              <Group gap="md" wrap="wrap">
                {[
                  ['#c0eb75', '0–3 %'],
                  ['#ffd43b', '3–6 %'],
                  ['#ff922b', '6–9 %'],
                  ['#f03e3e', '> 9 %'],
                ].map(([c, l]) => (
                  <Group key={l} gap={6}>
                    <Box w={12} h={12} style={{ borderRadius: 3, background: c }} />
                    <Text size="xs">{l}</Text>
                  </Group>
                ))}
                <Text size="xs" c="dimmed" ml="auto">
                  Revêtement : calculé depuis OpenStreetMap dans une prochaine version
                </Text>
              </Group>
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
              <SimpleGrid cols={5} pt="xs" style={{ borderTop: '1px solid #f1f3f5' }}>
                <Stat value={`${km1(t.distanceKm)} km`} label="Distance" />
                <Stat value={`${int(t.elevationGain)} m`} label="Montée" />
                <Stat value={`${int(t.elevationLoss)} m`} label="Descente" />
                <Stat value={`${int(t.eleMax)} m`} label="Point culminant" />
                <Stat value={`${int(t.eleMin)} m`} label="Point le plus bas" />
              </SimpleGrid>
            </Stack>
          </Paper>
        </Stack>

        <Stack gap="md" style={{ flex: '1 1 300px', minWidth: 0 }}>
          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <Text fw={600}>Classement</Text>
              <Select
                label="Sport"
                description="Sert au rangement des bibliothèques gérées. Effacer pour revenir au type lu dans le GPX."
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
              <Select
                label="Type de revêtement"
                placeholder="Non renseigné"
                clearable
                data={Object.entries(SURFACES).map(([value, label]) => ({ value, label }))}
                value={t.surfaceType}
                onChange={(v) => {
                  setT({ ...t, surfaceType: v })
                  api.setSurfaceType(t.id, v)
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
              <Group gap="md">
                <Text size="sm">Relief : {HILLINESS[t.hilliness]}</Text>
                <Group gap={4} c="blue.8">
                  <WindArrow wind={t.wind} />
                  <Text size="sm" c="blue.8">
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
                  {visiblePois.length} sur la carte / {t.pois.length}
                </Text>
              </Group>
              {t.pois.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Ce fichier ne contient pas de points d'intérêt (waypoints).
                </Text>
              ) : (
                <>
                  <Checkbox label="Afficher les POI sur la carte" checked={mapPois} onChange={(e) => setMapPois(e.currentTarget.checked)} fw={600} />
                  <Group gap="xs">
                    <Button size="compact-xs" variant="default" onClick={() => (setMapPois(true), setAll(true))}>
                      Tout cocher
                    </Button>
                    <Button size="compact-xs" variant="default" onClick={() => setAll(false)}>
                      Tout décocher
                    </Button>
                  </Group>
                  <SegmentedControl
                    size="xs"
                    value={poiOrder}
                    onChange={(v) => setPoiOrder(v as 'km' | 'kind')}
                    data={[
                      { value: 'km', label: 'Par km' },
                      { value: 'kind', label: 'Par catégorie' },
                    ]}
                  />
                  <ScrollArea.Autosize mah={420}>
                    <Stack gap={0}>
                      {poiOrder === 'km'
                        ? t.pois.map((p, i) => poiRow(p, i))
                        : POI_KINDS.map((k) => {
                            const idx = t.pois.map((p, i) => (p.kind === k.kind ? i : -1)).filter((i) => i >= 0)
                            if (!idx.length) return null
                            const on = idx.filter((i) => checked(i)).length
                            return (
                              <Box key={k.kind} mt={6}>
                                <Group
                                  gap={8}
                                  px={8}
                                  py={6}
                                  wrap="nowrap"
                                  style={{ background: k.color, borderRadius: 8, position: 'sticky', top: 0, zIndex: 1 }}
                                >
                                  <Checkbox
                                    size="xs"
                                    color="dark"
                                    styles={{ input: { borderColor: '#fff' } }}
                                    checked={on === idx.length}
                                    indeterminate={on > 0 && on < idx.length}
                                    onChange={(e) => {
                                      const v = e.currentTarget.checked
                                      if (v) setMapPois(true)
                                      setPicks((s) => ({ ...s, ...Object.fromEntries(idx.map((i) => [i, v])) }))
                                    }}
                                    aria-label={`Afficher tous les POI ${k.label}`}
                                  />
                                  <Text size="sm" fw={700} c="white" style={{ flex: 1 }}>
                                    {k.label}
                                  </Text>
                                  <Text size="xs" c="white" opacity={0.85}>
                                    {on}/{idx.length}
                                  </Text>
                                </Group>
                                <Box pl={4}>{idx.map((i) => poiRow(t.pois[i], i))}</Box>
                              </Box>
                            )
                          })}
                    </Stack>
                  </ScrollArea.Autosize>
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
