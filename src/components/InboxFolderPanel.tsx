import { useEffect, useState } from 'react'
import { Button, Code, Group, Paper, Stack, Text } from '@mantine/core'
import { open } from '@tauri-apps/plugin-dialog'
import { api } from '../api'

/**
 * Connexions → gpx.studio (dossier surveillé) : là où arrivent les GPX exportés de gpx.studio
 * (ou d'un autre site). Organisons propose de remplacer la trace modifiée ou
 * d'ajouter le fichier à une bibliothèque gérée.
 */
export default function InboxFolderPanel() {
  const [dir, setDir] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.inboxDir().then(setDir).catch((e) => setError(String(e)))
  }, [])

  const choose = async () => {
    setError(null)
    const picked = await open({ directory: true, title: 'Dossier où arrivent les GPX exportés', defaultPath: dir || undefined })
    if (typeof picked !== 'string') return
    try {
      await api.inboxSetDir(picked)
      setDir(picked)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap={6}>
        <Text size="xs" c="dimmed">
          « Modifier dans gpx.studio » (fiche d’une trace) ouvre la trace dans ton navigateur. Le GPX exporté depuis gpx.studio arrive dans ce
          dossier : Organisons propose alors de remplacer la trace (l’ancienne version va dans la Corbeille) ou de l’ajouter à une bibliothèque
          gérée. Tout GPX déposé ici, d’où qu’il vienne, est proposé de la même façon. Seuls les fichiers arrivés après la mise en service sont
          pris en compte, et rien n’est fait sans ton accord.
        </Text>
        <Group>
          <Code style={{ flex: 1 }}>{dir || '…'}</Code>
          <Button variant="default" onClick={choose}>
            Changer…
          </Button>
        </Group>
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
      </Stack>
    </Paper>
  )
}
