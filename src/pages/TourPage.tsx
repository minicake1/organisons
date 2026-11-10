import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Menu,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { IconArrowLeft, IconChevronDown, IconDownload, IconExternalLink, IconGripVertical, IconPencil, IconSquareCheck } from '@tabler/icons-react'
import { open as openDialog, save } from '@tauri-apps/plugin-dialog'
import { api, type Poi, type ProfilePoint, type TraceDetail } from '../api'
import ElevationProfile from '../components/ElevationProfile'
import SportBadge from '../components/SportBadge'
import TraceMap from '../components/TraceMap'
import BatchEditModal from '../components/BatchEditModal'
import TrashButton from '../components/TrashButton'
import { sendToKaroo } from '../sendToKaroo'
import { int, km1, poiKind, slopeColor } from '../labels'

/** Couleur de chaque étape sur la carte et le profil. */
const STAGE_COLORS = ['#1c7ed6', '#e8590c', '#2b8a3e', '#ae3ec9', '#f08c00', '#0b7285', '#c2255c', '#5c940d']
const stageColor = (i: number) => STAGE_COLORS[i % STAGE_COLORS.length]

/**
 * Vue d'un tour : ses étapes enchaînées (carte, profil, chiffres de l'ensemble)
 * ou une étape seule, ordre modifiable, export en un GPX ou étape par étape.
 */
export default function TourPage({ id, onBack, onOpen }: { id: number; onBack: () => void; onOpen: (traceId: number) => void }) {
  const [stages, setStages] = useState<TraceDetail[] | null>(null)
  const [name, setName] = useState('')
  const [sel, setSel] = useState<number | null>(null)
  // Étape survolée dans la liste : elle ressort sur la carte et le profil, les autres s’atténuent.
  const [hover, setHover] = useState<number | null>(null)
  const [hlSlope, setHlSlope] = useState<string | null>(null)
  // Glisser-déposer des étapes (événements de pointeur : marche aussi dans la fenêtre Tauri).
  const [drag, setDragState] = useState<{ from: number; over: number } | null>(null)
  const dragRef = useRef<{ from: number; over: number } | null>(null)
  const pending = useRef<{ i: number; x: number; y: number } | null>(null)
  const justDragged = useRef(false)
  const reorderRef = useRef<(from: number, to: number) => void>(() => {})
  const setDrag = (d: { from: number; over: number } | null) => {
    dragRef.current = d
    setDragState(d)
  }
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = pending.current
      if (p && !dragRef.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 5) setDrag({ from: p.i, over: p.i })
    }
    const onUp = () => {
      const d = dragRef.current
      pending.current = null
      if (!d) return
      justDragged.current = true
      if (d.from !== d.over) reorderRef.current(d.from, d.over)
      setDrag(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<'stage' | 'slope'>('stage')
  const [cursor, setCursor] = useState<number | null>(null)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Sélection pour modifier ou supprimer plusieurs étapes, comme dans la Bibliothèque.
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [batchOpen, setBatchOpen] = useState(false)
  const [karoo, setKaroo] = useState(false)
  useEffect(() => {
    api.hammerheadStatus().then((s) => setKaroo(s.connected)).catch(() => {})
  }, [])

  const reload = () => {
    api
      .tourStages(id)
      .then((s) => {
        setStages(s)
        setSel((cur) => (cur != null && cur < s.length ? cur : null))
        setPicked((p) => p.filter((x) => s.some((t) => t.id === x)))
      })
      .catch((e) => setError(String(e)))
    api
      .collections()
      .then((cs) => setName(cs.find((c) => c.id === id)?.name ?? "Tour"))
      .catch(() => {})
  }
  useEffect(reload, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Profil enchaîné (km, D+ et D− cumulés d'une étape à l'autre) et étape de chaque point.
  const whole = useMemo(() => {
    const profile: ProfilePoint[] = []
    const stageOf: number[] = []
    const pois: Poi[] = []
    let km = 0
    let up = 0
    let down = 0
    ;(stages ?? []).forEach((s, i) => {
      for (const p of s.profile) {
        profile.push({ ...p, km: p.km + km, up: p.up + up, down: p.down + down, minutes: null })
        stageOf.push(i)
      }
      for (const p of s.pois) pois.push({ ...p, km: p.km + km })
      const last = s.profile[s.profile.length - 1]
      km += last?.km ?? s.distanceKm
      up += last?.up ?? s.elevationGain
      down += last?.down ?? s.elevationLoss
    })
    return { profile, stageOf, pois }
  }, [stages])

  // Tracé de chaque étape pour le halo de survol (calculé une fois : pas de redessin à chaque mouvement).
  const glowLines = useMemo(() => (stages ?? []).map((s) => s.profile.map((p) => [p.lon, p.lat] as [number, number])), [stages])

  if (error && !stages) return <Text c="red">{error}</Text>
  if (!stages) return <Loader />

  const one = sel != null ? stages[sel] : null
  const profile = one ? one.profile : whole.profile
  const colors = one
    ? one.profile.map((p) => (mode === 'slope' ? slopeColor(p.slopeMax) : stageColor(sel!)))
    : whole.profile.map((p, i) => (mode === 'slope' ? slopeColor(p.slopeMax) : stageColor(whole.stageOf[i])))
  // Survol : une étape de la liste, ou une tranche de pente de la légende ; le reste à 40 %.
  const shown = colors.map((c, i) => {
    const stageOk = one || hover == null || whole.stageOf[i] === hover
    const slopeOk = hlSlope == null || c === hlSlope
    return stageOk && slopeOk ? c : fade(c, 0.4)
  })
  const mapColors = shown
  const profileColors = shown
  const pois = (one ? one.pois : whole.pois).filter((p) => poiKind(p.kind).byDefault)
  const pick = stages.filter((_, i) => sel == null || i === sel)
  const total = {
    km: pick.reduce((a, s) => a + s.distanceKm, 0),
    up: pick.reduce((a, s) => a + s.elevationGain, 0),
    down: pick.reduce((a, s) => a + s.elevationLoss, 0),
    max: Math.max(...pick.map((s) => s.eleMax)),
    min: Math.min(...pick.map((s) => s.eleMin)),
  }

  // Glisser une étape à sa nouvelle place (souris) : enregistré tout de suite.
  const reorder = (from: number, to: number) => {
    const next = [...stages]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    const selId = sel != null ? stages[sel].id : null
    setStages(next)
    setSel(selId == null ? null : next.findIndex((s) => s.id === selId))
    setHover(null)
    api.setTourOrder(id, next.map((s) => s.id)).catch((e) => setError(String(e)))
  }
  reorderRef.current = reorder

  const exportOne = async () => {
    const path = await save({ title: 'Exporter le tour en un GPX', defaultPath: `${name}.gpx`, filters: [{ name: 'GPX', extensions: ['gpx'] }] })
    if (!path) return
    setError(null)
    api
      .exportTourGpx(id, path)
      .then((n) => setNotice(`Tour exporté : ${n} étape(s), une piste par étape, dans ${path}`))
      .catch((e) => setError(String(e)))
  }
  const exportStages = async () => {
    const dir = await openDialog({ directory: true, title: 'Dossier où copier les étapes' })
    if (typeof dir !== 'string') return
    setError(null)
    api
      .exportTourStages(id, dir)
      .then((files) => setNotice(`${files.length} étape(s) copiée(s) dans ${dir}`))
      .catch((e) => setError(String(e)))
  }

  return (
    <Stack gap="md" h="calc(100dvh - 2 * var(--mantine-spacing-lg))" style={{ overflow: 'hidden' }}>
      <Group>
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack} px={6}>
          Collections
        </Button>
        <Title order={2}>{name}</Title>
        <Badge color="orange" variant="light">
          Tour · {stages.length} étape(s)
        </Badge>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Button ml="auto" variant="default" leftSection={<IconDownload size={16} />} rightSection={<IconChevronDown size={14} />} disabled={!stages.length}>
              Exporter
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={exportOne}>Un GPX (une piste par étape)…</Menu.Item>
            <Menu.Item onClick={exportStages}>Étape par étape dans un dossier…</Menu.Item>
            {karoo && (
              <>
                <Menu.Divider />
                <Menu.Item
                  onClick={async () => {
                    setError(null)
                    setNotice("Envoi vers le Karoo…")
                    try {
                      const { text, report } = await sendToKaroo(
                        stages.map((s) => s.id),
                        (d, n) => setNotice(`Envoi vers le Karoo : ${d} / ${n} étape(s)…`),
                      )
                      setNotice(text)
                      if (report.errors.length) setError(report.errors.slice(0, 3).join(" / "))
                    } catch (e) {
                      setNotice(null)
                      setError(String(e))
                    }
                  }}
                >
                  Envoyer les {stages.length} étapes vers le Karoo
                </Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
      {notice && (
        <Paper withBorder p="sm" bg="teal.0" c="teal.9" onClick={() => setNotice(null)} style={{ wordBreak: 'break-all' }}>
          {notice}
        </Paper>
      )}
      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      {stages.length === 0 ? (
        <Paper withBorder p="xl" ta="center">
          <Text>Ce tour n'a pas encore d'étape : ajoute des traces à la collection « {name} ».</Text>
        </Paper>
      ) : (
        <Group align="stretch" gap="md" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
          <Paper withBorder radius="md" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box style={{ position: 'relative', flex: 1, minHeight: 200 }}>
              <TraceMap
                key={sel ?? 'tout'}
                profile={profile}
                pois={pois}
                cursor={cursor}
                colors={mapColors}
                onView={setRange}
                glow={!one && hover != null ? glowLines[hover] : null}
              />
            </Box>
            <Stack gap="sm" p="md">
              <Group>
                <Text fw={600} mr="auto">
                  Profil {one ? `de l'étape ${sel! + 1}` : 'du tour'}
                </Text>
                <SegmentedControl
                  size="xs"
                  value={mode}
                  onChange={(v) => setMode(v as 'stage' | 'slope')}
                  data={[
                    { value: 'stage', label: 'Étapes' },
                    { value: 'slope', label: 'Pente' },
                  ]}
                />
              </Group>
              <ElevationProfile
                key={sel ?? 'tout'}
                profile={profile}
                pois={pois}
                cursor={cursor}
                onCursor={setCursor}
                colors={profileColors}
                range={range}
                height="clamp(130px, 20vh, 220px)"
              />
              {mode === 'slope' && (
                <Group gap="md" wrap="wrap">
                  {[
                    ['#c0eb75', '0–3 %'],
                    ['#ffd43b', '3–6 %'],
                    ['#ff922b', '6–9 %'],
                    ['#f03e3e', '> 9 %'],
                  ].map(([c, l]) => (
                    <Group
                      key={l}
                      gap={6}
                      onMouseEnter={() => setHlSlope(c)}
                      onMouseLeave={() => setHlSlope(null)}
                      style={{ cursor: 'default', padding: '2px 6px', margin: '-2px -6px', borderRadius: 6, background: hlSlope === c ? '#f1f3f5' : undefined }}
                    >
                      <Box w={12} h={12} style={{ borderRadius: 3, background: c }} />
                      <Text size="xs">{l}</Text>
                    </Group>
                  ))}
                </Group>
              )}
              <SimpleGrid cols={5} pt="xs" style={{ borderTop: '1px solid #f1f3f5' }}>
                <Stat value={`${km1(total.km)} km`} label="Distance" />
                <Stat value={`${int(total.up)} m`} label="Montée" />
                <Stat value={`${int(total.down)} m`} label="Descente" />
                <Stat value={`${int(total.max)} m`} label="Point culminant" />
                <Stat value={one ? `${sel! + 1} / ${stages.length}` : `${stages.length}`} label={one ? 'Étape' : 'Étapes'} />
              </SimpleGrid>
            </Stack>
          </Paper>

          <Stack gap="xs" style={{ width: 360, flexShrink: 0, overflowY: 'auto', paddingRight: 4 }}>
            <UnstyledButton
              onClick={() => setSel(null)}
              p="sm"
              style={{ borderRadius: 8, border: '1px solid #dee2e6', background: sel == null ? '#fff4e6' : '#fff' }}
            >
              <Text fw={600} size="sm">
                Tout le tour
              </Text>
              <Text size="xs" c="dimmed">
                {km1(stages.reduce((a, s) => a + s.distanceKm, 0))} km · ↑ {int(stages.reduce((a, s) => a + s.elevationGain, 0))} m
              </Text>
            </UnstyledButton>
            <Group gap="xs" px={4} wrap="nowrap">
              <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                {selecting ? 'Clique sur les étapes à sélectionner.' : 'Glisse la poignée ⋮⋮ pour changer l’ordre ; clic pour voir l’étape seule.'}
              </Text>
              <Button
                size="compact-xs"
                variant={selecting ? 'filled' : 'default'}
                leftSection={<IconSquareCheck size={14} />}
                onClick={() => {
                  setSelecting((v) => !v)
                  setPicked([])
                }}
              >
                {selecting ? 'Terminer' : 'Sélectionner'}
              </Button>
            </Group>
            {selecting && (
              <Paper withBorder p="xs" radius="md" bg="blue.0">
                <Group gap={6}>
                  <Text size="xs" fw={600}>
                    {picked.length} étape(s)
                  </Text>
                  <Button size="compact-xs" variant="subtle" onClick={() => setPicked(stages.map((s) => s.id))}>
                    Toutes
                  </Button>
                  <Button size="compact-xs" variant="subtle" onClick={() => setPicked([])} disabled={!picked.length}>
                    Aucune
                  </Button>
                  <Button size="compact-xs" ml="auto" leftSection={<IconPencil size={12} />} disabled={!picked.length} onClick={() => setBatchOpen(true)}>
                    Modifier…
                  </Button>
                </Group>
              </Paper>
            )}
            <BatchEditModal
              opened={batchOpen}
              traces={stages.filter((s) => picked.includes(s.id))}
              onClose={() => setBatchOpen(false)}
              onDone={(message, warnings) => {
                setBatchOpen(false)
                setNotice(message)
                if (warnings.length) setError(warnings.slice(0, 3).join(" / "))
                reload()
              }}
            />
            {stages.map((s, i) => {
              const dragging = drag?.from === i
              const target = drag != null && drag.over === i && drag.from !== i
              // Repère de dépôt : au-dessus si on remonte l'étape, en dessous si on la descend.
              const dropLine = target ? (drag!.over < drag!.from ? '0 -3px 0 0 #4263eb' : '0 3px 0 0 #4263eb') : undefined
              const glow = hover === i && !drag ? '0 0 0 2px #ffe066, 0 0 12px rgba(255, 212, 59, 0.75)' : undefined
              return (
                <Paper
                  key={s.id}
                  withBorder
                  p="sm"
                  radius="md"
                  onPointerEnter={() => {
                    if (dragRef.current) setDrag({ ...dragRef.current, over: i })
                  }}
                  onClick={() => {
                    if (justDragged.current) {
                      justDragged.current = false
                      return
                    }
                    if (selecting) setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))
                    else setSel(i)
                  }}
                  onMouseEnter={() => !drag && setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    cursor: drag ? 'grabbing' : 'pointer',
                    userSelect: 'none',
                    touchAction: 'none',
                    opacity: dragging ? 0.5 : 1,
                    borderLeft: `5px solid ${stageColor(i)}`,
                    background: sel === i ? '#f4f6ff' : undefined,
                    boxShadow: dropLine ?? glow,
                    transition: 'box-shadow 0.12s',
                  }}
                >
                  <Group gap="xs" wrap="nowrap" align="flex-start">
                    {selecting ? (
                      <Checkbox aria-label={`Sélectionner ${s.name}`} checked={picked.includes(s.id)} readOnly mt={2} style={{ pointerEvents: "none" }} />
                    ) : (
                      // Seule la poignée permet de glisser l’étape.
                      <Tooltip label="Glisser pour déplacer l’étape" openDelay={500}>
                        <Box
                          aria-label={`Déplacer ${s.name}`}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return
                            e.stopPropagation()
                            pending.current = { i, x: e.clientX, y: e.clientY }
                          }}
                          style={{ cursor: drag ? "grabbing" : "grab", flex: "none", marginTop: 2, touchAction: "none", lineHeight: 0 }}
                        >
                          <IconGripVertical size={18} color="#868e96" />
                        </Box>
                      </Tooltip>
                    )}
                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={600} lineClamp={2}>
                        {i + 1}. {s.name}
                      </Text>
                      <Group gap="xs">
                        <SportBadge sport={s.sport} size="xs" />
                        <Text size="xs" c="dimmed">
                          {km1(s.distanceKm)} km · ↑ {int(s.elevationGain)} m
                        </Text>
                      </Group>
                    </Stack>
                    <TrashButton trace={s} onTrashed={reload} />
                    <Tooltip label="Ouvrir la fiche de l'étape">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        aria-label={`Ouvrir ${s.name}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => (e.stopPropagation(), onOpen(s.id))}
                      >
                        <IconExternalLink size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Paper>
              )
            })}
          </Stack>
        </Group>
      )}
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

/** Couleur atténuée (mélangée à du blanc) : les autres étapes restent reconnaissables. */
function fade(color: string, amount: number): string {
  const n = parseInt(color.slice(1), 16)
  const mix = (v: number) => Math.round(v + (255 - v) * amount)
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`
}
