import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Checkbox, Group, Loader, Paper, PasswordInput, Progress, ScrollArea, SegmentedControl, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { IconDownload, IconLogout, IconRefresh } from '@tabler/icons-react'
import { listen } from '@tauri-apps/api/event'
import { api, type Library, type PedalonsAccount, type PedalonsEvent } from '../api'
import { int, km1 } from '../labels'

const day = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}
const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

/**
 * Connexions → Pédalons : connexion au compte, agenda des sorties et étapes
 * des équipes, import de leurs parcours dans une bibliothèque gérée.
 */
export default function PedalonsPage({
  onLibrary,
  mode,
  onSwitch,
}: {
  onLibrary: () => void
  /** « login » : Connexions → Pédalons (connexion seule) ; « agenda » : onglet Agenda. */
  mode: "login" | "agenda"
  /** Vers l’autre écran (Agenda depuis Connexions, Connexions depuis l’Agenda). */
  onSwitch: () => void
}) {
  const [account, setAccount] = useState<PedalonsAccount | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [events, setEvents] = useState<PedalonsEvent[] | null>(null)
  const [range, setRange] = useState<'next' | 'past'>('next')
  const [onlyMine, setOnlyMine] = useState(true)
  const [hideImported, setHideImported] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [libraries, setLibraries] = useState<Library[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState<'login' | 'list' | 'import' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    const off = listen<{ done: number; total: number }>('pedalons-progress', (e) => setProgress(e.payload))
    return () => {
      off.then((f) => f())
    }
  }, [])

  const load = (r = range) => {
    setBusy('list')
    setError(null)
    const [from, to] = r === 'next' ? [day(-1), day(90)] : [day(-365), day(1)]
    api
      .pedalonsEvents(from, to)
      .then((ev) => setEvents(r === 'past' ? ev.reverse() : ev))
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(null))
  }

  useEffect(() => {
    api
      .pedalonsStatus()
      .then((a) => {
        setAccount(a)
        if (a && mode === "agenda") load()
      })
      .catch(() => setAccount(null))
    api
      .listLibraries()
      .then((ls) => {
        const managed = ls.filter((l) => l.mode === 'managed')
        setLibraries(managed)
        if (managed.length) setTarget(String(managed[0].id))
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(
    () => (events ?? []).filter((e) => (!onlyMine || e.registered) && !(hideImported && e.imported)),
    [events, onlyMine, hideImported],
  )

  const login = async () => {
    setBusy('login')
    setError(null)
    try {
      const a = await api.pedalonsLogin(email, password)
      setPassword('')
      setAccount(a)
      if (mode === "agenda") load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy((b) => (b === 'login' ? null : b))
    }
  }

  // Parcours ignorés car un parcours très proche est déjà là : détail et « importer quand même ».
  const [skipped, setSkipped] = useState<{ lines: string[]; events: PedalonsEvent[] } | null>(null)

  const importPicked = async (force = false, only?: PedalonsEvent[]) => {
    if (!target) return
    setBusy('import')
    setError(null)
    setNotice(null)
    setSkipped(null)
    try {
      const chosen = only ?? (events ?? []).filter((e) => picked.includes(e.id))
      setProgress({ done: 0, total: chosen.length })
      const r = await api.pedalonsImport(Number(target), chosen, force)
      setNotice(
        `${r.imported} parcours importé(s) dans « ${libraries.find((l) => String(l.id) === target)?.name} »` +
          (r.skipped.length ? `, ${r.skipped.length} ignoré(s) car déjà dans la bibliothèque :` : '.'),
      )
      if (r.skipped.length) setSkipped({ lines: r.skipped, events: chosen })
      if (r.errors.length) setError(r.errors.slice(0, 5).join('\n'))
      setPicked([])
      load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  if (account === undefined) return <Loader />

  // Onglet Agenda sans compte : la connexion se fait dans Connexions → Pédalons.
  if (!account && mode === 'agenda')
    return (
      <Paper withBorder radius="md" p="md" maw={560}>
        <Stack gap="sm">
          <Text size="sm">L’agenda affiche les sorties et étapes de voyage de tes équipes Pédalons, et importe leurs parcours.</Text>
          <Group>
            <Button onClick={onSwitch}>Connecter mon compte Pédalons</Button>
          </Group>
        </Stack>
      </Paper>
    )

  // Connexions → Pédalons, compte connecté : seulement l'état et la déconnexion.
  if (account && mode === 'login')
    return (
      <Paper withBorder radius="md" p="md" maw={560}>
        <Stack gap="sm">
          <Group>
            <Badge color="green" variant="light">
              Connecté
            </Badge>
            <Text size="sm">
              <b>{account.displayName}</b> ({account.email})
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            Seul un jeton de session est gardé, dans le gestionnaire d’identifiants de Windows ; il est renouvelé à chaque utilisation.
          </Text>
          <Group>
            <Button onClick={onSwitch}>Ouvrir l’agenda</Button>
            <Button variant="subtle" color="gray" leftSection={<IconLogout size={14} />} onClick={() => api.pedalonsLogout().then(() => setAccount(null))}>
              Déconnecter
            </Button>
          </Group>
        </Stack>
      </Paper>
    )

  if (!account)
    return (
      <Paper withBorder radius="md" p="md" maw={560}>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Connecte ton compte Pédalons pour voir l’agenda de tes équipes et importer les parcours des sorties. Le mot de passe ne sert qu’une
            fois : seul un jeton de session est gardé, dans le gestionnaire d’identifiants de Windows.
          </Text>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              login()
            }}
          >
            <Stack gap="xs">
              <TextInput label="Adresse e-mail" autoComplete="username" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
              <PasswordInput label="Mot de passe" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
              <Group>
                <Button type="submit" loading={busy === 'login'} disabled={!email.trim() || !password}>
                  Se connecter
                </Button>
              </Group>
            </Stack>
          </form>
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Paper>
    )

  return (
    <Stack gap="md" maw={1100}>
      <Group>
        <Text size="sm">
          Connecté : <b>{account.displayName}</b> ({account.email})
        </Text>
        <Button size="xs" variant="subtle" color="gray" leftSection={<IconLogout size={14} />} onClick={() => api.pedalonsLogout().then(() => setAccount(null))}>
          Déconnecter
        </Button>
      </Group>

      <Group gap="sm">
        <SegmentedControl
          size="xs"
          value={range}
          onChange={(v) => {
            setRange(v as 'next' | 'past')
            setPicked([])
            load(v as 'next' | 'past')
          }}
          data={[
            { value: 'next', label: 'À venir (3 mois)' },
            { value: 'past', label: 'Passées (1 an)' },
          ]}
        />
        <Checkbox size="xs" label="Seulement mes inscriptions" checked={onlyMine} onChange={(e) => setOnlyMine(e.currentTarget.checked)} />
        <Checkbox size="xs" label="Masquer les déjà importées" checked={hideImported} onChange={(e) => setHideImported(e.currentTarget.checked)} />
        <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={busy === 'list'} onClick={() => load()} ml="auto">
          Actualiser
        </Button>
      </Group>

      <Paper withBorder radius="md">
        <ScrollArea.Autosize mah="55vh">
          <Table highlightOnHover verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36}>
                  <Checkbox
                    aria-label="Tout sélectionner"
                    checked={shown.length > 0 && shown.every((e) => picked.includes(e.id))}
                    onChange={(ev) => setPicked(ev.currentTarget.checked ? shown.map((e) => e.id) : [])}
                  />
                </Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Sortie</Table.Th>
                <Table.Th>Équipe</Table.Th>
                <Table.Th ta="right">Distance</Table.Th>
                <Table.Th ta="right">D+</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((e) => (
                <Table.Tr key={e.id} onClick={() => setPicked((p) => (p.includes(e.id) ? p.filter((x) => x !== e.id) : [...p, e.id]))} style={{ cursor: 'pointer' }}>
                  <Table.Td>
                    <Checkbox aria-label={`Sélectionner ${e.title}`} checked={picked.includes(e.id)} readOnly style={{ pointerEvents: 'none' }} />
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{when(e.start)}</Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" lineClamp={1}>
                        {e.title}
                      </Text>
                      {e.kind === 'TRIP_STAGE' && (
                        <Badge size="xs" variant="light">
                          étape
                        </Badge>
                      )}
                      {e.registered && (
                        <Badge size="xs" variant="light" color="teal">
                          {e.groupName ? `inscrit · ${e.groupName}` : 'inscrit'}
                        </Badge>
                      )}
                      {e.imported && (
                        <Badge size="xs" variant="light" color="gray">
                          importée
                        </Badge>
                      )}
                    </Group>
                    {e.startPlace && (
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {e.startPlace}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={1}>
                      {e.teamName}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                    {e.distanceKm != null ? `${km1(e.distanceKm)} km` : '—'}
                  </Table.Td>
                  <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                    {e.elevationGain != null ? `${int(e.elevationGain)} m` : '—'}
                  </Table.Td>
                </Table.Tr>
              ))}
              {events && shown.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text size="sm" c="dimmed" ta="center" py="md">
                      {onlyMine ? 'Aucune sortie où tu es inscrit sur cette période.' : 'Aucune sortie sur cette période.'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      </Paper>

      <Group>
        {libraries.length > 0 ? (
          <Select
            size="sm"
            w={260}
            data={libraries.map((l) => ({ value: String(l.id), label: `Importer dans : ${l.name}` }))}
            value={target}
            onChange={setTarget}
            allowDeselect={false}
          />
        ) : (
          <Text size="sm" c="dimmed">
            Crée d’abord une bibliothèque gérée dans Réglages.
          </Text>
        )}
        <Button leftSection={<IconDownload size={16} />} disabled={!picked.length || !target} loading={busy === 'import'} onClick={() => importPicked()}>
          Importer {picked.length || ''} parcours
        </Button>
        {notice && (
          <Button variant="subtle" onClick={onLibrary}>
            Voir la bibliothèque
          </Button>
        )}
      </Group>
      {progress && busy === 'import' && <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />}
      {notice && (
        <Text size="sm" c="var(--mantine-color-teal-light-color)">
          {notice}
        </Text>
      )}
      {skipped && (
        <Paper withBorder radius="md" p="sm">
          <Stack gap={6}>
            {skipped.lines.map((l) => (
              <Text key={l} size="sm">
                {l}
              </Text>
            ))}
            {skipped.lines.some((l) => !l.includes('fichier identique')) && (
              <Group gap="xs">
                <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                  « Ressemble à » : même distance (±1 %), même dénivelé (±5 %), départ et arrivée à moins de 300 m. Si c’est bien un autre
                  parcours, importe-le quand même ; un fichier identique, lui, n’est jamais importé deux fois.
                </Text>
                <Button size="xs" variant="light" loading={busy === 'import'} onClick={() => importPicked(true, skipped.events)}>
                  Importer quand même
                </Button>
              </Group>
            )}
          </Stack>
        </Paper>
      )}
      {error && (
        <Text size="sm" c="red" style={{ whiteSpace: 'pre-line' }}>
          {error}
        </Text>
      )}
    </Stack>
  )
}
