import { useEffect, useState } from 'react'
import { Button, Group, Paper, Progress, Select, Stack, Text, Textarea, Title } from '@mantine/core'
import { IconDownload } from '@tabler/icons-react'
import { listen } from '@tauri-apps/api/event'
import { api, type Library } from '../api'

/**
 * Onglet Openrunner : coller les liens de parcours publics, ils sont
 * téléchargés et rangés dans une bibliothèque gérée.
 */
export default function OpenrunnerPage({ onLibrary }: { onLibrary: () => void }) {
  const [links, setLinks] = useState('')
  const [libraries, setLibraries] = useState<Library[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    api
      .listLibraries()
      .then((ls) => {
        const managed = ls.filter((l) => l.mode === 'managed')
        setLibraries(managed)
        if (managed.length) setTarget(String(managed[0].id))
      })
      .catch(() => {})
    const off = listen<{ done: number; total: number }>('openrunner-progress', (e) => setProgress(e.payload))
    return () => {
      off.then((f) => f())
    }
  }, [])

  const list = links
    .split(/[\s,;]+/)
    .map((l) => l.trim())
    .filter(Boolean)

  const run = async () => {
    if (!target) return
    setBusy(true)
    setNotice(null)
    setErrors([])
    setProgress({ done: 0, total: list.length })
    try {
      const r = await api.openrunnerImport(Number(target), list)
      setNotice(
        `${r.imported} parcours importé(s) dans « ${libraries.find((l) => String(l.id) === target)?.name} »` +
          (r.skipped.length ? `, ${r.skipped.length} ignoré(s) car déjà dans la bibliothèque.` : "."),
      )
      setErrors(r.errors)
      if (r.imported) setLinks('')
    } catch (e) {
      setErrors([String(e)])
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Stack gap="md" maw={860}>
      <Title order={2}>Openrunner</Title>
      <Text size="sm" c="dimmed">
        Colle les liens de tes parcours Openrunner (un par ligne, ou séparés par des espaces), par exemple
        « https://www.openrunner.com/route-details/24118757 ». Les parcours publics sont téléchargés avec leurs points d'intérêt ; un
        parcours privé doit être exporté depuis le site puis importé comme un fichier.
      </Text>
      <Paper withBorder radius="md" p="md">
        <Stack gap="sm">
          <Textarea
            label="Liens des parcours"
            placeholder="https://www.openrunner.com/route-details/…"
            autosize
            minRows={4}
            maxRows={14}
            value={links}
            onChange={(e) => setLinks(e.currentTarget.value)}
          />
          <Group>
            {libraries.length === 0 ? (
              <Text size="sm" c="dimmed">
                Crée d'abord une bibliothèque gérée dans Réglages.
              </Text>
            ) : (
              <Select
                w={260}
                label="Importer dans"
                data={libraries.map((l) => ({ value: String(l.id), label: l.name }))}
                value={target}
                onChange={setTarget}
                allowDeselect={false}
              />
            )}
            <Button ml="auto" mt="auto" leftSection={<IconDownload size={16} />} loading={busy} disabled={!list.length || !target} onClick={run}>
              Importer {list.length || ''} parcours
            </Button>
          </Group>
          {busy && progress && (
            <Stack gap={4}>
              <Text size="sm">
                Import : {progress.done} / {progress.total} parcours
              </Text>
              <Progress value={progress.total ? (100 * progress.done) / progress.total : 0} />
            </Stack>
          )}
        </Stack>
      </Paper>
      {notice && (
        <Paper withBorder p="sm" bg="teal.0" c="teal.9">
          <Group gap="xs">
            <Text size="sm">{notice}</Text>
            <Button size="compact-sm" variant="white" onClick={onLibrary}>
              Voir la Bibliothèque
            </Button>
          </Group>
        </Paper>
      )}
      {errors.length > 0 && (
        <Paper withBorder p="sm" bg="orange.0">
          <Text size="sm" fw={600} mb={4}>
            {errors.length} parcours non importé(s) :
          </Text>
          {errors.map((e, i) => (
            <Text key={i} size="xs">
              {e}
            </Text>
          ))}
        </Paper>
      )}
    </Stack>
  )
}
