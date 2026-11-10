import { useEffect, useMemo, useState } from 'react'
import { Badge, Box, Button, Card, Group, Menu, Modal, Paper, Select, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { IconChevronDown, IconFileImport, IconSearch } from '@tabler/icons-react'
import { open } from '@tauri-apps/plugin-dialog'
import { api, type Library, type WorkoutSummary } from '../api'
import WorkoutChart, { ZONES } from '../components/WorkoutChart'
import WorkoutDetail from '../components/WorkoutDetail'
import WorkoutSendMenu from '../components/WorkoutSendMenu'

const minutes = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

type Sort = 'recent' | 'name' | 'duration' | 'tss'

/**
 * Onglet Entraînements : séances Zwift (.zwo) trouvées dans les bibliothèques ou
 * importées, avec durée, intensité, charge (TSS) et profil de puissance ; envoi
 * vers le Karoo par Hammerhead.
 */
export default function WorkoutsPage() {
  const [list, setList] = useState<WorkoutSummary[] | null>(null)
  const [libraries, setLibraries] = useState<Library[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [shown, setShown] = useState<WorkoutSummary | null>(null)
  const [sent, setSent] = useState<number[]>([])
  const [busy, setBusy] = useState<number | 'import' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    api
      .listWorkouts()
      .then(setList)
      .catch((e) => setError(String(e)))
    api
      .workoutsSent()
      .then(setSent)
      .catch(() => {})
  }
  useEffect(() => {
    refresh()
    api
      .listLibraries()
      .then((ls) => setLibraries(ls.filter((l) => l.mode === 'managed')))
      .catch(() => {})
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = (list ?? []).filter((w) => !q || w.name.toLowerCase().includes(q) || w.tags.some((t) => t.toLowerCase().includes(q)))
    const by: Record<Sort, (a: WorkoutSummary, b: WorkoutSummary) => number> = {
      recent: (a, b) => b.addedAt - a.addedAt,
      name: (a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }),
      duration: (a, b) => a.duration - b.duration,
      tss: (a, b) => b.tss - a.tss,
    }
    return [...out].sort(by[sort])
  }, [list, query, sort])

  const importInto = async (l: Library) => {
    const picked = await open({ multiple: true, title: `Importer des séances dans « ${l.name} »`, filters: [{ name: 'Séances Zwift', extensions: ['zwo', 'ZWO'] }] })
    const files = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : []
    if (!files.length) return
    setBusy('import')
    setError(null)
    try {
      const r = await api.importWorkouts(l.id, files)
      setNotice(`${r.imported} séance(s) importée(s) dans « ${l.name} » (dossier Entraînements).`)
      if (r.errors.length) setError(r.errors.slice(0, 5).join(' / '))
      refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  const importButton =
    libraries.length === 0 ? (
      <Tooltip label="L'import se fait dans une bibliothèque gérée : crée-en une dans Réglages. Les .zwo des bibliothèques sont lus à la relecture.">
        <Button variant="default" leftSection={<IconFileImport size={16} />} data-disabled onClick={(e) => e.preventDefault()}>
          Importer des séances…
        </Button>
      </Tooltip>
    ) : libraries.length === 1 ? (
      <Button variant="default" leftSection={<IconFileImport size={16} />} loading={busy === 'import'} onClick={() => importInto(libraries[0])}>
        Importer des séances…
      </Button>
    ) : (
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button variant="default" leftSection={<IconFileImport size={16} />} rightSection={<IconChevronDown size={14} />} loading={busy === 'import'}>
            Importer des séances…
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {libraries.map((l) => (
            <Menu.Item key={l.id} onClick={() => importInto(l)}>
              {l.name}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    )

  return (
    <Stack gap="md">
      <Group>
        <Title order={2} mr="auto">
          Entraînements
        </Title>
        {importButton}
      </Group>
      <Group>
        <TextInput
          placeholder="Rechercher par nom ou tag…"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          style={{ flex: 1, maxWidth: 420 }}
        />
        <Select
          w={220}
          aria-label="Trier"
          allowDeselect={false}
          value={sort}
          onChange={(v) => setSort((v as Sort) ?? 'recent')}
          data={[
            { value: 'recent', label: 'Plus récents' },
            { value: 'name', label: 'Nom' },
            { value: 'duration', label: 'Durée' },
            { value: 'tss', label: 'Charge (TSS)' },
          ]}
        />
        <Group gap={8} ml="auto">
          {ZONES.map(([c, l]) => (
            <Group key={l} gap={4}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
              <Text size="xs" c="dimmed">
                {l}
              </Text>
            </Group>
          ))}
        </Group>
      </Group>
      {notice && (
        <Paper withBorder p="sm" bg="teal.0" c="teal.9" onClick={() => setNotice(null)}>
          {notice}
        </Paper>
      )}
      {error && (
        <Paper withBorder p="sm" bg="red.0" c="red.9" onClick={() => setError(null)}>
          {error}
        </Paper>
      )}
      {list && list.length === 0 && (
        <Paper withBorder p="xl" ta="center" style={{ borderStyle: 'dashed' }}>
          <Text fw={600}>Aucun entraînement pour l'instant</Text>
          <Text c="dimmed" size="sm">
            Importe des séances Zwift (.zwo), ou range-les dans un dossier de bibliothèque puis « Relire les dossiers ».
          </Text>
        </Paper>
      )}
      <Box className="tile-grid">
        {visible.map((w) => (
          <Card key={w.id} withBorder radius="md" padding="sm" style={{ cursor: 'pointer' }} onClick={() => setShown(w)}>
            <Card.Section>
              <WorkoutChart blocks={w.blocks} height={80} />
            </Card.Section>
            <Stack gap={6} mt="sm">
              <Text fw={700} lineClamp={1}>
                {w.name}
              </Text>
              <Group gap="md">
                <Text size="sm">{minutes(w.duration)}</Text>
                <Text size="sm" c="dimmed">
                  IF {w.intensity.toFixed(2).replace('.', ',')}
                </Text>
                <Text size="sm" c="dimmed">
                  TSS {Math.round(w.tss)}
                </Text>
              </Group>
              <Group gap={6}>
                <Badge size="sm" variant="light" color={w.sport === 'run' ? 'orange' : 'indigo'}>
                  {w.sport === 'run' ? 'Course' : 'Vélo'}
                </Badge>
                {w.tags.slice(0, 3).map((t) => (
                  <Badge key={t} size="sm" variant="light" color="gray" tt="none">
                    {t}
                  </Badge>
                ))}
                {sent.includes(w.id) && (
                  <Badge size="sm" variant="outline" color="green">
                    Sur le Karoo
                  </Badge>
                )}
              </Group>
            </Stack>
          </Card>
        ))}
      </Box>

      <Modal opened={shown !== null} onClose={() => setShown(null)} title={shown?.name} size="min(1400px, 92vw)">
        {shown && (
          <Stack gap="sm">
            <Group gap="lg">
              <Text size="sm">
                <b>{minutes(shown.duration)}</b>
              </Text>
              <Text size="sm">
                IF <b>{shown.intensity.toFixed(2).replace('.', ',')}</b>
              </Text>
              <Text size="sm">
                TSS <b>{Math.round(shown.tss)}</b>
              </Text>
              {shown.author && (
                <Text size="sm" c="dimmed">
                  Auteur : {shown.author}
                </Text>
              )}
              <Group ml="auto">
                <WorkoutSendMenu
                  workout={shown}
                  sentToKaroo={sent.includes(shown.id)}
                  onSent={() => api.workoutsSent().then(setSent).catch(() => {})}
                  onMessage={(text, isError) => (isError ? setError(text) : setNotice(text))}
                />
              </Group>
            </Group>
            {shown.description && (
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {shown.description}
              </Text>
            )}
            <WorkoutDetail workout={shown} />
            <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
              {shown.path}
            </Text>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
