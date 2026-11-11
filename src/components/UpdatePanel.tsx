import { useEffect, useState } from 'react'
import { Anchor, Button, Group, Paper, Progress, Stack, Text } from '@mantine/core'
import { IconDownload, IconRefresh } from '@tabler/icons-react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'


const SKIP_KEY = 'organisons.updateSkip'
const releasePage = (version: string) => `https://github.com/minicake1/organisons/releases/tag/v${version}`

const skipped = () => {
  try {
    return localStorage.getItem(SKIP_KEY)
  } catch {
    return null
  }
}
const skip = (version: string) => {
  try {
    localStorage.setItem(SKIP_KEY, version)
  } catch {
    /* préférence non gardée : la version sera reproposée au prochain lancement */
  }
}

/**
 * Télécharge le paquet (vérifié par la clé publique de tauri.conf.json), lance
 * l'installateur puis redémarre. Sous Windows l'installateur ferme l'appli lui-même.
 */
function useInstall(update: Update | null) {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const install = async () => {
    if (!update) return
    setError(null)
    setProgress(0)
    let total = 0
    let done = 0
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0
        if (e.event === 'Progress') {
          done += e.data.chunkLength
          if (total) setProgress(Math.min(100, (done / total) * 100))
        }
        if (e.event === 'Finished') setProgress(100)
      })
      await relaunch()
    } catch (e) {
      setProgress(null)
      setError(`Mise à jour impossible : ${e}`)
    }
  }
  return { progress, error, install }
}

function UpdateBody({ update, onLater }: { update: Update; onLater?: () => void }) {
  const { progress, error, install } = useInstall(update)
  return (
    <Stack gap={6}>
      <Group gap="sm">
        <Text size="sm" mr="auto">
          <b>Organisons {update.version}</b> est disponible (tu as la {update.currentVersion}).{' '}
          <Anchor size="sm" href={releasePage(update.version)} target="_blank">
            Voir les nouveautés
          </Anchor>
        </Text>
        {onLater && progress === null && (
          <Button size="xs" variant="subtle" color="gray" onClick={onLater}>
            Plus tard
          </Button>
        )}
        <Button size="xs" leftSection={<IconDownload size={14} />} loading={progress !== null} onClick={install}>
          Installer et redémarrer
        </Button>
      </Group>
      {progress !== null && <Progress size="sm" value={progress} animated />}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  )
}

/** Bandeau en haut de l'appli quand une version plus récente est publiée (vérifié au lancement). */
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null)
  useEffect(() => {
    // En développement, la version installée par la Release remplacerait l'appli : pas de vérification automatique.
    if (import.meta.env.DEV) return
    check()
      .then((u) => u && u.version !== skipped() && setUpdate(u))
      .catch(() => {}) // hors ligne ou GitHub injoignable : on réessaiera au prochain lancement
  }, [])
  if (!update) return null
  return (
    <Paper withBorder p="sm" mb="md" bg="var(--mantine-color-indigo-light)">
      <UpdateBody
        update={update}
        onLater={() => {
          skip(update.version)
          setUpdate(null)
        }}
      />
    </Paper>
  )
}

/** Réglages → À propos : vérification à la demande. */
export function UpdateCheck() {
  const [state, setState] = useState<'idle' | 'checking' | 'none' | Update | string>('idle')
  const run = () => {
    setState('checking')
    check()
      .then((u) => setState(u ?? 'none'))
      .catch((e) =>
        setState(
          /valid release JSON|404/i.test(String(e))
            ? 'Pas encore de version avec mise à jour intégrée (à partir de la v0.8), ou GitHub injoignable.'
            : `Vérification impossible : ${e}`,
        ),
      )
  }
  return (
    <Stack gap={6}>
      <Group gap="sm">
        <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={state === 'checking'} onClick={run}>
          Vérifier les mises à jour
        </Button>
        {state === 'none' && (
          <Text size="sm" c="dimmed">
            Organisons est à jour.
          </Text>
        )}
        {typeof state === 'string' && !['idle', 'checking', 'none'].includes(state) && (
          <Text size="sm" c="red">
            {state}
          </Text>
        )}
      </Group>
      {typeof state === 'object' &&
        (import.meta.env.DEV ? (
          <Text size="sm">
            Organisons {state.version} est disponible. En développement, installe-la depuis la{' '}
            <Anchor size="sm" href={releasePage(state.version)} target="_blank">
              page de la version
            </Anchor>
            .
          </Text>
        ) : (
          <UpdateBody update={state} />
        ))}
    </Stack>
  )
}
