import { useEffect, useMemo, useState } from 'react'
import { Anchor, Button, Checkbox, Group, Loader, Modal, NumberInput, Paper, Progress, Select, Stack, Text } from '@mantine/core'
import { IconWorldSearch } from '@tabler/icons-react'
import { listen } from '@tauri-apps/api/event'
import { api, type OsmCandidate, type OsmDensity, type OsmRules, type PoiKind } from '../api'
import { POI_KINDS, km1 } from '../labels'
import { PoiCategory, PoiDot } from './PoiCategory'

/** Distances proposées (m) ; 30 m : « sur la trace ». */
const DISTANCES = [
  { value: '30', label: 'Sur la trace (30 m)' },
  { value: '100', label: '100 m au plus' },
  { value: '200', label: '200 m au plus' },
  { value: '500', label: '500 m au plus' },
  { value: '1000', label: '1 km au plus' },
  { value: '2000', label: '2 km au plus' },
]

/**
 * Densité : dans chaque catégorie, au plus `count` propositions par tranche de
 * `everyKm` km (0 à 10 km, 10 à 20 km…) : les plus proches de la trace, à égalité
 * celles qui ont un vrai nom. Sans densité, tout est gardé.
 */
function thin(found: OsmCandidate[], density: OsmDensity | null): OsmCandidate[] {
  if (!density || density.count < 1 || !(density.everyKm > 0)) return found
  const slices = new Map<string, OsmCandidate[]>()
  for (const c of found) {
    const key = `${c.kind}:${Math.floor(c.km / density.everyKm)}`
    slices.set(key, [...(slices.get(key) ?? []), c])
  }
  const named = (c: OsmCandidate) => (c.name !== c.what ? 0 : 1)
  return [...slices.values()]
    .flatMap((list) => [...list].sort((a, b) => a.distanceM - b.distanceM || named(a) - named(b)).slice(0, density.count))
    .sort((a, b) => a.km - b.km)
}

/** Ce que l'on cherche dans chaque catégorie (pour l'aide sous la règle). */
const SEARCHED: Partial<Record<PoiKind, string>> = {
  water: 'eau potable, points d’eau, robinets, fontaines et sources potables',
  service: 'toilettes, réparation vélo, magasins de vélos, pharmacies',
  shop: 'boulangeries, épiceries, supermarchés, cafés, restaurants, bars, stations-service',
  lodging: 'hôtels, chambres d’hôtes, auberges, gîtes, campings, refuges',
  sight: 'points de vue, curiosités, châteaux, monuments, sommets',
}

const detour = (m: number) => (m <= 30 ? 'sur la trace' : `détour ${m * 2 >= 1000 ? `${km1((m * 2) / 1000)} km` : `${Math.round((m * 2) / 10) * 10} m`}`)

/**
 * POI proposés depuis OpenStreetMap le long d'une trace : règles par catégorie
 * (pour cette recherche, ou gardées par défaut), puis choix des points à ajouter.
 */
export default function OsmPoiModal({
  traceId,
  opened,
  onClose,
  onAdd,
}: {
  traceId: number
  opened: boolean
  onClose: () => void
  /** Ajoute les points choisis au GPX (comme « Ajouter un POI »). */
  onAdd: (picked: OsmCandidate[]) => void
}) {
  const [rules, setRules] = useState<OsmRules | null>(null)
  // Densité : case cochée, nombre par tranche, taille de la tranche (km).
  const [dense, setDense] = useState(false)
  const [count, setCount] = useState(1)
  const [everyKm, setEveryKm] = useState(10)
  // Rien de proposé avant ce km (départ connu, ravitaillement inutile au début).
  const [startKm, setStartKm] = useState(0)
  const [saved, setSaved] = useState<string>('')
  const [found, setFound] = useState<OsmCandidate[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [folded, setFolded] = useState<Partial<Record<PoiKind, boolean>>>({})

  useEffect(() => {
    if (!opened) return
    setFound(null)
    setPicked([])
    setError(null)
    api
      .osmRules()
      .then(({ rules: r, density: d, startKm: sk }) => {
        setRules(r)
        setStartKm(sk)
        setDense(!!d)
        if (d) {
          setCount(d.count)
          setEveryKm(d.everyKm)
        }
        setSaved(JSON.stringify([r, d ?? null, sk]))
      })
      .catch((e) => setError(String(e)))
  }, [opened])

  useEffect(() => {
    const off = listen<{ done: number; total: number }>('osm-progress', (e) => setProgress(e.payload))
    return () => {
      off.then((f) => f())
    }
  }, [])

  const kinds = useMemo(() => POI_KINDS.filter((k) => rules?.[k.kind]), [rules])
  const density: OsmDensity | null = dense ? { count, everyKm } : null
  const settingsKey = JSON.stringify([rules, density, startKm])
  const shown = useMemo(() => (found ? thin(found.filter((c) => c.km >= startKm), density) : null), [found, dense, count, everyKm, startKm]) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = useMemo(() => (shown ?? []).filter((c) => picked.includes(c.id)), [shown, picked])
  const setRule = (k: PoiKind, change: Partial<{ enabled: boolean; maxM: number }>) =>
    setRules((r) => (r && r[k] ? { ...r, [k]: { ...r[k]!, ...change } } : r))

  const search = async () => {
    if (!rules) return
    setBusy(true)
    setError(null)
    setProgress(null)
    try {
      const c = await api.osmSearch(traceId, rules)
      setFound(c)
      setPicked(c.map((x) => x.id))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const keepAsDefault = () =>
    rules &&
    api
      .osmRulesSet(rules, density, startKm)
      .then(() => setSaved(settingsKey))
      .catch((e) => setError(String(e)))

  const toggle = (id: string, v: boolean) => setPicked((p) => (v ? [...p, id] : p.filter((x) => x !== id)))

  return (
    <Modal opened={opened} onClose={onClose} title="POI proposés depuis OpenStreetMap" size="xl">
      {!rules ? (
        error ? <Text c="red">{error}</Text> : <Loader />
      ) : (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Ce qu’il y a le long de la trace, d’après OpenStreetMap. Pour chaque catégorie : sur la trace (visible sans détour) ou à une distance
            au plus. Ces règles valent pour cette recherche ; « Garder par défaut » les enregistre.
          </Text>
          <Stack gap={6}>
            {kinds.map((k) => {
              const r = rules[k.kind]!
              return (
                <Group key={k.kind} gap="sm" wrap="nowrap">
                  <Checkbox
                    checked={r.enabled}
                    onChange={(e) => setRule(k.kind, { enabled: e.currentTarget.checked })}
                    label={
                      <Group gap={6} wrap="nowrap">
                        <PoiDot kind={k.kind} />
                        <Text size="sm" fw={600}>
                          {k.label}
                        </Text>
                      </Group>
                    }
                    w={150}
                  />
                  <Select
                    size="xs"
                    w={170}
                    allowDeselect={false}
                    disabled={!r.enabled}
                    value={String(r.maxM)}
                    data={DISTANCES.some((d) => d.value === String(r.maxM)) ? DISTANCES : [...DISTANCES, { value: String(r.maxM), label: `${r.maxM} m au plus` }]}
                    onChange={(v) => v && setRule(k.kind, { maxM: Number(v) })}
                  />
                  <Text size="xs" c="dimmed" style={{ flex: 1 }} lineClamp={2}>
                    {SEARCHED[k.kind]}
                  </Text>
                </Group>
              )
            })}
          </Stack>
          <Group gap={8} wrap="nowrap">
            <Text size="sm">Ne rien proposer avant le km</Text>
            <NumberInput
              size="xs"
              w={80}
              min={0}
              max={10000}
              decimalScale={1}
              decimalSeparator=","
              value={startKm}
              onChange={(v) => setStartKm(typeof v === 'number' && v > 0 ? v : 0)}
              aria-label="Premier km où proposer des POI"
            />
            <Text size="xs" c="dimmed">
              (0 : dès le départ)
            </Text>
          </Group>
          {/* Densité : commune aux catégories, comptée pour chacune à part ; appliquée tout de suite aux résultats. */}
          <Group gap={8} wrap="nowrap">
            <Checkbox label="Limiter à" checked={dense} onChange={(e) => setDense(e.currentTarget.checked)} />
            <NumberInput
              size="xs"
              w={70}
              min={1}
              max={99}
              allowDecimal={false}
              disabled={!dense}
              value={count}
              onChange={(v) => typeof v === 'number' && v >= 1 && setCount(v)}
              aria-label="Nombre de propositions par tranche"
            />
            <Text size="sm" c={dense ? undefined : 'dimmed'}>
              proposition(s) par catégorie tous les
            </Text>
            <NumberInput
              size="xs"
              w={80}
              min={0.5}
              max={1000}
              step={1}
              decimalScale={1}
              decimalSeparator=","
              disabled={!dense}
              value={everyKm}
              onChange={(v) => typeof v === 'number' && v > 0 && setEveryKm(v)}
              aria-label="Taille de la tranche (km)"
            />
            <Text size="sm" c={dense ? undefined : 'dimmed'}>
              km (les plus proches de la trace)
            </Text>
          </Group>
          <Group gap="xs">
            <Button leftSection={<IconWorldSearch size={16} />} loading={busy} onClick={search} disabled={!kinds.some((k) => rules[k.kind]?.enabled)}>
              Chercher le long de la trace
            </Button>
            {settingsKey !== saved && (
              <Button variant="subtle" onClick={keepAsDefault}>
                Garder par défaut
              </Button>
            )}
          </Group>
          {busy && progress && progress.total > 1 && (
            <Progress size="sm" value={(progress.done / progress.total) * 100} animated />
          )}
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}

          {found && (
            <>
              <Group gap="xs">
                <Text size="sm" fw={600} mr="auto">
                  {found.length
                    ? `${shown!.length} point(s) proposé(s)${shown!.length < found.length ? ` (${found.length} trouvés, densité appliquée)` : ''}, ${chosen.length} choisi(s)`
                    : 'Rien trouvé avec ces règles.'}
                </Text>
                {found.length > 0 && (
                  <>
                    <Button size="compact-xs" variant="default" onClick={() => setPicked(found.map((c) => c.id))}>
                      Tout cocher
                    </Button>
                    <Button size="compact-xs" variant="default" onClick={() => setPicked([])}>
                      Tout décocher
                    </Button>
                  </>
                )}
              </Group>
              {found.length > 0 && (
                <Paper withBorder radius="md" px="sm" pb="sm" mah="45vh" style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}>
                  {POI_KINDS.map((k) => {
                    const items = shown!.filter((c) => c.kind === k.kind)
                    if (!items.length) return null
                    const on = items.filter((c) => picked.includes(c.id)).length
                    return (
                      <PoiCategory
                        key={k.kind}
                        kind={k.kind}
                        count={`${on}/${items.length}`}
                        folded={!!folded[k.kind]}
                        onFold={() => setFolded((f) => ({ ...f, [k.kind]: !f[k.kind] }))}
                        check={{
                          checked: on === items.length,
                          indeterminate: on > 0 && on < items.length,
                          label: `Choisir tous les POI ${k.label}`,
                          onChange: (v) =>
                            setPicked((p) => (v ? [...new Set([...p, ...items.map((c) => c.id)])] : p.filter((id) => !items.some((c) => c.id === id)))),
                        }}
                      >
                        {items.map((c) => (
                          <Group key={c.id} gap={8} py={6} wrap="nowrap" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                            <Checkbox size="sm" checked={picked.includes(c.id)} onChange={(e) => toggle(c.id, e.currentTarget.checked)} aria-label={c.name} />
                            <PoiDot kind={c.kind} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Text size="sm" lineClamp={1}>
                                {c.name}
                              </Text>
                              <Text size="xs" c="dimmed" lineClamp={1}>
                                {c.what !== c.name ? `${c.what} · ` : ''}
                                {detour(c.distanceM)}
                              </Text>
                            </div>
                            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                              km {km1(c.km)}
                            </Text>
                          </Group>
                        ))}
                      </PoiCategory>
                    )
                  })}
                </Paper>
              )}
            </>
          )}

          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed">
              Données ©{' '}
              <Anchor size="xs" href="https://www.openstreetmap.org/copyright" target="_blank">
                contributeurs OpenStreetMap
              </Anchor>{' '}
              (ODbL), par l’API Overpass.
            </Text>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                Fermer
              </Button>
              <Button
                disabled={!chosen.length}
                onClick={() => {
                  onAdd(chosen)
                  onClose()
                }}
              >
                Ajouter {chosen.length || ''} POI
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
