import { useEffect, useState } from 'react'
import { Anchor, Badge, Button, Group, Paper, PasswordInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { api, type IcuStatus } from '../api'

/** Dossier Zwift choisi, mémorisé sur ce PC. */
export const ZWIFT_KEY = 'organisons.zwiftFolder'
export function savedZwiftFolder(): string | null {
  try {
    return localStorage.getItem(ZWIFT_KEY)
  } catch {
    return null
  }
}

/**
 * Réglages → Plateformes d'entraînement : dossier Zwift (copie des .zwo) et
 * compte intervals.icu (clé d'API personnelle).
 */
export default function TrainingPlatformsPanel() {
  const [folders, setFolders] = useState<string[]>([])
  const [folder, setFolder] = useState<string | null>(savedZwiftFolder())
  const [icu, setIcu] = useState<IcuStatus | null>(null)
  const [athlete, setAthlete] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .zwiftFolders()
      .then((f) => {
        setFolders(f)
        if (!savedZwiftFolder() && f[0]) choose(f[0])
      })
      .catch(() => {})
    api
      .icuStatus()
      .then((s) => {
        setIcu(s)
        setAthlete(s.athleteId)
      })
      .catch(() => {})
  }, [])

  const choose = (f: string | null) => {
    setFolder(f)
    try {
      if (f) localStorage.setItem(ZWIFT_KEY, f)
      else localStorage.removeItem(ZWIFT_KEY)
    } catch {
      // mémoire indisponible : le choix vaut pour cette fois
    }
  }

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      setIcu(await api.icuConnect(athlete, key))
      setKey('')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <Stack gap={6}>
          <Group>
            <Text fw={600}>Zwift</Text>
            <Badge color={folder ? 'green' : 'gray'} variant="light">
              {folder ? 'Dossier trouvé' : 'Zwift introuvable sur ce PC'}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            Zwift lit les séances personnelles dans Documents\Zwift\Workouts\&lt;identifiant Zwift&gt;. Organisons y copie les .zwo ; elles
            apparaissent dans « Custom Workouts » au prochain lancement de Zwift.
          </Text>
          {folders.length > 0 && (
            <Select
              label="Dossier Zwift (ton identifiant)"
              data={folders}
              value={folder}
              onChange={choose}
              allowDeselect={false}
              maw={620}
            />
          )}
        </Stack>

        <Stack gap={6}>
          <Group>
            <Text fw={600}>intervals.icu</Text>
            <Badge color={icu?.connected ? 'green' : 'gray'} variant="light">
              {icu?.connected ? `Connecté : ${icu.name}` : 'Pas connecté'}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            Sur intervals.icu : Settings → Developer Settings, recopie l'identifiant d'athlète (i123456) et génère une clé d'API. La clé est
            rangée dans le gestionnaire d'identifiants de Windows. Les séances planifiées peuvent ensuite partir vers Zwift, Garmin ou MyWhoosh
            depuis intervals.icu.{' '}
            <Anchor size="xs" href="https://intervals.icu/settings" target="_blank">
              Ouvrir intervals.icu
            </Anchor>
          </Text>
          <Group align="flex-end">
            <TextInput label="Identifiant d'athlète" placeholder="i123456" autoComplete="off" value={athlete} onChange={(e) => setAthlete(e.currentTarget.value)} />
            <PasswordInput
              label="Clé d'API"
              autoComplete="new-password"
              placeholder={icu?.connected ? 'Enregistrée' : ''}
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
              w={260}
            />
            <Button onClick={connect} loading={busy} disabled={!athlete.trim() || !key.trim()}>
              {icu?.connected ? 'Mettre à jour' : 'Connecter'}
            </Button>
            {icu?.connected && (
              <Button
                variant="subtle"
                color="gray"
                onClick={() =>
                  api
                    .icuDisconnect()
                    .then(() => api.icuStatus().then(setIcu))
                    .catch((e) => setError(String(e)))
                }
              >
                Déconnecter
              </Button>
            )}
          </Group>
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Stack>
    </Paper>
  )
}
