import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Paper,
  PasswordInput,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,

} from '@mantine/core'
import { IconAlertTriangle, IconDownload, IconLogout, IconRefresh } from '@tabler/icons-react'
import { listen } from '@tauri-apps/api/event'
import { api, type KomootAccount, type KomootTour, type Library } from '../api'
import { int, km1 } from '../labels'

/**
 * Onglet Komoot : connexion au compte, liste des parcours (préparés et
 * réalisés) et import dans une bibliothèque gérée. API interne de Komoot, non
 * officielle : elle peut cesser de fonctionner à tout moment.
 */
export default function KomootPage({ onLibrary }: { onLibrary: () => void }) {
  const [account, setAccount] = useState<KomootAccount | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tours, setTours] = useState<KomootTour[] | null>(null)
  const [libraries, setLibraries] = useState<Library[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const [kind, setKind] = useState<'all' | 'planned' | 'recorded'>('all')
  const [hideImported, setHideImported] = useState(true)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState<'login' | 'list' | 'import' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Avancement envoyé par le cœur (lecture de la liste, puis import parcours par parcours).
  const [progress, setProgress] = useState<{ phase: "list" | "import"; done: number; total: number } | null>(null)
  useEffect(() => {
    const off = listen<{ phase: "list" | "import"; done: number; total: number }>("komoot-progress", (e) => setProgress(e.payload))
    return () => {
      off.then((f) => f())
    }
  }, [])

  const loadTours = () => {
    setBusy('list')
    setError(null)
    api
      .komootTours()
      .then(setTours)
      .catch((e) => setError(String(e)))
      .finally(() => {
        setBusy(null)
        setProgress(null)
      })
  }

  useEffect(() => {
    api
      .komootStatus()
      .then((a) => {
        setAccount(a)
        if (a) loadTours()
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
    () => (tours ?? []).filter((t) => (kind === 'all' || t.kind === kind) && !(hideImported && t.imported)),
    [tours, kind, hideImported],
  )

  const login = async () => {
    setBusy('login')
    setError(null)
    try {
      const a = await api.komootLogin(email, password)
      setPassword('')
      setAccount(a)
      loadTours()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy((b) => (b === 'login' ? null : b))
    }
  }

  const importPicked = async () => {
    if (!target) return
    setBusy('import')
    setError(null)
    setNotice(null)
    try {
      setProgress({ phase: 'import', done: 0, total: picked.length })
      const r = await api.komootImport(Number(target), picked)
      setNotice(
        `${r.imported} parcours importé(s) dans « ${libraries.find((l) => String(l.id) === target)?.name} »` +
          (r.skipped.length ? `, ${r.skipped.length} ignoré(s) car déjà dans la bibliothèque.` : "."),
      )
      if (r.errors.length) setError(r.errors.slice(0, 5).join('\n'))
      setPicked([])
      loadTours()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  if (account === undefined) return <Loader />

  return (
    <Stack gap="md" maw={1100}>
      <Alert color="yellow" icon={<IconAlertTriangle size={18} />} p="sm">
        Komoot n'a pas d'API publique : Organisons utilise celle de son site, comme ses applis. Elle peut changer ou cesser de fonctionner
        sans prévenir.
      </Alert>

      {!account ? (
        <Paper withBorder radius="md" p="md" maw={480}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              login()
            }}
          >
            <Stack gap="sm">
              <Text fw={600}>Connexion à ton compte Komoot</Text>
              <TextInput label="Adresse e-mail" value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="username" />
              <PasswordInput label="Mot de passe" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" />
              <Text size="xs" c="dimmed">
                Le mot de passe sert une seule fois à obtenir un jeton d'accès ; il n'est pas conservé. Le jeton est rangé dans le gestionnaire
                d'identifiants de Windows.
              </Text>
              <Group justify="flex-end">
                <Button type="submit" loading={busy === 'login'} disabled={!email.trim() || !password}>
                  Se connecter
                </Button>
              </Group>
            </Stack>
          </form>
        </Paper>
      ) : (
        <Group>
          <Text size="sm">
            Connecté : <b>{account.displayName}</b> ({account.email})
          </Text>
          <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={busy === 'list'} onClick={loadTours}>
            Recharger
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<IconLogout size={14} />}
            onClick={() =>
              api
                .komootLogout()
                .then(() => {
                  setAccount(null)
                  setTours(null)
                })
                .catch((e) => setError(String(e)))
            }
          >
            Se déconnecter
          </Button>
        </Group>
      )}

      {progress && (busy === "list" || busy === "import") && (
        <Paper withBorder p="sm" radius="md">
          <Text size="sm" mb={6}>
            {progress.phase === "list"
              ? `Lecture de la liste Komoot : ${progress.done} parcours…`
              : `Import : ${progress.done} / ${progress.total} parcours (téléchargement, analyse et rangement de chacun)`}
          </Text>
          <Progress value={progress.total ? (100 * progress.done) / progress.total : 100} animated={progress.phase === "list"} striped={progress.phase === "list"} />
        </Paper>
      )}
      {error && (
        <Paper withBorder p="sm" bg="var(--mantine-color-red-light)" c="var(--mantine-color-red-light-color)" style={{ whiteSpace: 'pre-line' }}>
          {error}
        </Paper>
      )}
      {notice && (
        <Paper withBorder p="sm" bg="var(--mantine-color-teal-light)" c="var(--mantine-color-teal-light-color)">
          <Group gap="xs">
            <Text size="sm">{notice}</Text>
            <Button size="compact-sm" variant="white" onClick={onLibrary}>
              Voir la Bibliothèque
            </Button>
          </Group>
        </Paper>
      )}

      {account && tours === null && busy === 'list' && <Loader />}
      {account && tours && (
        <Paper withBorder radius="md">
          <Group p="sm" gap="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
            <SegmentedControl
              size="xs"
              value={kind}
              onChange={(v) => setKind(v as typeof kind)}
              data={[
                { value: 'all', label: `Tous (${tours.length})` },
                { value: 'planned', label: 'Planifiés' },
                { value: 'recorded', label: 'Réalisés' },
              ]}
            />
            <Checkbox label="Masquer les déjà importés" checked={hideImported} onChange={(e) => setHideImported(e.currentTarget.checked)} />
            <Group gap="xs" ml="auto">
              {libraries.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Crée d'abord une bibliothèque gérée dans Réglages.
                </Text>
              ) : (
                <Select
                  size="xs"
                  w={200}
                  aria-label="Bibliothèque où importer"
                  data={libraries.map((l) => ({ value: String(l.id), label: `Importer dans ${l.name}` }))}
                  value={target}
                  onChange={setTarget}
                  allowDeselect={false}
                />
              )}
              <Button
                size="xs"
                leftSection={<IconDownload size={14} />}
                disabled={!picked.length || !target}
                loading={busy === 'import'}
                onClick={importPicked}
              >
                Importer {picked.length || ''} parcours
              </Button>
            </Group>
          </Group>
          {shown.length === 0 ? (
            <Text p="md" size="sm" c="dimmed">
              Aucun parcours à afficher.
            </Text>
          ) : (
            <ScrollArea.Autosize mah="60vh">
              <Table highlightOnHover verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={40}>
                      <Checkbox
                        aria-label="Tout sélectionner"
                        checked={shown.every((t) => picked.includes(t.id))}
                        indeterminate={picked.length > 0 && !shown.every((t) => picked.includes(t.id))}
                        onChange={(e) => setPicked(e.currentTarget.checked ? shown.map((t) => t.id) : [])}
                      />
                    </Table.Th>
                    <Table.Th>Parcours</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Distance</Table.Th>
                    <Table.Th>D+</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {shown.map((t) => (
                    <Table.Tr
                      key={t.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))}
                    >
                      <Table.Td>
                        <Checkbox aria-label={`Sélectionner ${t.name}`} checked={picked.includes(t.id)} readOnly style={{ pointerEvents: 'none' }} />
                      </Table.Td>
                      <Table.Td fw={600}>{t.name}</Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={t.kind === 'recorded' ? 'green' : 'blue'}>
                          {t.kind === 'recorded' ? 'Réalisé' : 'Planifié'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{km1(t.distanceKm)} km</Table.Td>
                      <Table.Td>{int(t.elevationUp)} m</Table.Td>
                      <Table.Td c="dimmed">{t.date ? new Date(t.date).toLocaleDateString('fr-FR') : '—'}</Table.Td>
                      <Table.Td>
                        {t.imported && (
                          <Badge size="sm" variant="outline" color="gray">
                            Déjà importé
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Paper>
      )}
    </Stack>
  )
}
