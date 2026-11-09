import { useEffect, useState } from 'react'
import { ActionIcon, Badge, Button, Code, Group, Paper, Radio, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { IconFolderPlus, IconTrash } from '@tabler/icons-react'
import { open } from '@tauri-apps/plugin-dialog'
import { api, type Library, type ScanReport } from '../api'

export default function SettingsPage() {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [name, setName] = useState('')
  const [mode, setMode] = useState<Library['mode']>('index')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ScanReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => api.listLibraries().then(setLibraries).catch((e) => setError(String(e)))
  useEffect(() => {
    refresh()
  }, [])

  const add = async () => {
    const dir = await open({ directory: true, title: 'Dossier de GPX (sur ce PC ou sur le NAS)' })
    if (typeof dir !== 'string') return
    setBusy(true)
    setError(null)
    try {
      const label = name.trim() || dir.split(/[\\/]/).filter(Boolean).pop() || dir
      setReport(await api.addLibrary(label, dir, mode))
      setName('')
      refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap="md" maw={960}>
      <Title order={2}>Stockage</Title>

      <Paper withBorder radius="md">
        <Group p="md" style={{ borderBottom: '1px solid #e9ecef' }}>
          <Text fw={600}>Bibliothèques</Text>
        </Group>
        {libraries.length === 0 && (
          <Text p="md" c="dimmed" size="sm">
            Aucun dossier pour l'instant.
          </Text>
        )}
        {libraries.map((l) => (
          <Group key={l.id} p="md" style={{ borderBottom: '1px solid #f1f3f5' }} wrap="nowrap">
            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <Group gap="xs">
                <Text fw={600}>{l.name}</Text>
                <Badge variant="light" color={l.mode === 'managed' ? 'indigo' : 'gray'}>
                  {l.mode === 'managed' ? 'Bibliothèque gérée' : 'Indexée sur place'}
                </Badge>
              </Group>
              <Code>{l.path}</Code>
            </Stack>
            <Tooltip label="Retirer de l'appli (les fichiers ne sont pas supprimés)">
              <ActionIcon variant="subtle" color="red" aria-label={`Retirer ${l.name}`} onClick={() => api.removeLibrary(l.id).then(refresh)}>
                <IconTrash size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        ))}
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Stack gap="sm">
          <Text fw={600}>Ajouter un dossier</Text>
          <TextInput label="Nom affiché" placeholder="Ex. NAS · Vélo" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Radio.Group label="Mode" value={mode} onChange={(v) => setMode(v as Library['mode'])}>
            <Stack gap={6} mt={6}>
              <Radio value="index" label="Indexer sur place : l'appli lit les fichiers sans jamais les déplacer" />
              <Radio
                value="managed"
                label="Ranger automatiquement selon {sport}/{année}/{nom}.gpx"
                description="Le rangement des fichiers arrive en v0.2 ; pour l'instant le dossier est seulement indexé."
              />
            </Stack>
          </Radio.Group>
          <Group>
            <Button leftSection={<IconFolderPlus size={16} />} loading={busy} onClick={add}>
              Choisir le dossier…
            </Button>
            <Text size="xs" c="dimmed">
              Un partage NAS fonctionne s'il est accessible depuis l'explorateur (lecteur réseau ou chemin \\NAS\…).
            </Text>
          </Group>
          {report && (
            <Text size="sm">
              {report.added} ajoutée(s), {report.updated} mise(s) à jour, {report.unchanged} inchangée(s), {report.removed} retirée(s)
              {report.errors.length > 0 && ` · ${report.errors.length} erreur(s)`}
            </Text>
          )}
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Paper>
    </Stack>
  )
}
