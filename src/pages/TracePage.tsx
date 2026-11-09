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
import { api, type PoiKind, type TraceDetail } from '../api'
import { HILLINESS, POI_KINDS, SURFACES, int, km1, poiKind, windLabel } from '../labels'
import ElevationProfile from '../components/ElevationProfile'
import TraceMap from '../components/TraceMap'
import WindArrow from '../components/WindArrow'

export default function TracePage({ id, onBack }: { id: number; onBack: () => void }) {
  const [t, setT] = useState<TraceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [mode, setMode] = useState<'slope' | 'surface'>('slope')
  const [mapPois, setMapPois] = useState(true)
  const [kinds, setKinds] = useState<Partial<Record<PoiKind, boolean>>>({})
  const [picks, setPicks] = useState<Record<number, boolean>>({})
  const [allTags, setAllTags] = useState<string[]>([])

  useEffect(() => {
    api.getTrace(id).then(setT).catch((e) => setError(String(e)))
    api.allTags().then(setAllTags).catch(() => {})
  }, [id])

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

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack} px={6}>
          Bibliothèque
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
          <Tooltip label="Arrive en v0.2 (Garmin, Hammerhead, Wahoo, Edge en USB)">
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
                  api.setTags(t.id, tags)
                }}
              />
              <Textarea
                label="Notes"
                autosize
                minRows={3}
                defaultValue={t.notes}
                onBlur={(e) => api.setNotes(t.id, e.currentTarget.value)}
              />
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
                  <ScrollArea.Autosize mah={340}>
                    <Stack gap={0}>
                      {t.pois.map((p, i) => (
                        <Checkbox
                          key={i}
                          py={6}
                          style={{ borderBottom: '1px solid #f1f3f5' }}
                          checked={checked(i)}
                          onChange={(e) => setPicks((s) => ({ ...s, [i]: e.currentTarget.checked }))}
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
                      ))}
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
