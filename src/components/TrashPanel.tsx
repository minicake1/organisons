import { useEffect, useState } from 'react'
import { Button, Code, Group, Modal, Paper, Select, Stack, Text } from '@mantine/core'
import { api, type SetAsideInfo } from '../api'
import { date } from '../labels'

/**
 * Corbeille d'Organisons : traces supprimées, dont le GPX attend dans le dossier
 * `.organisons-corbeille` de sa bibliothèque. Vidage manuel (confirmé, définitif)
 * ou automatique après 7, 14 ou 30 jours.
 */
export default function TrashPanel({ version = 0, onChanged }: { version?: number; onChanged?: () => void }) {
  const [info, setInfo] = useState<SetAsideInfo | null>(null)
  const [days, setDays] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => api.trashInfo().then(setInfo).catch((e) => setError(String(e)))
  useEffect(() => {
    refresh()
    api.getTrashPurgeDays().then(setDays).catch(() => {})
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Paper withBorder radius="md" p="md">
      <Group gap="md" align="flex-end" wrap="wrap">
        <Stack gap={2} style={{ flex: '1 1 260px' }}>
          <Text fw={600}>Corbeille</Text>
          <Text size="sm" c="dimmed">
            {info && info.count > 0
              ? `${info.count} trace(s), ${mo(info.bytes)}${info.oldest ? `, la plus ancienne supprimée le ${date(info.oldest)}` : ''}`
              : 'La corbeille est vide.'}
          </Text>
          <Text size="xs" c="dimmed">
            Les traces supprimées attendent dans le dossier <Code>.organisons-corbeille</Code> de leur bibliothèque ; on peut les y reprendre
            tant que la corbeille n'est pas vidée.
          </Text>
        </Stack>
        <Select
          label="Vider automatiquement"
          w={220}
          allowDeselect={false}
          data={[
            { value: '0', label: 'Jamais' },
            { value: '7', label: 'Après 7 jours' },
            { value: '14', label: 'Après 14 jours' },
            { value: '30', label: 'Après 30 jours' },
          ]}
          value={String(days)}
          onChange={(v) => {
            const d = Number(v ?? 0)
            setDays(d)
            api
              .setTrashPurgeDays(d)
              .then(() => {
                refresh()
                onChanged?.()
              })
              .catch((e) => setError(String(e)))
          }}
        />
        <Button color="red" variant="light" disabled={!info?.count} onClick={() => setConfirm(true)}>
          Vider maintenant
        </Button>
      </Group>
      {message && (
        <Text size="sm" c="teal.8" mt="xs">
          {message}
        </Text>
      )}
      {error && (
        <Text size="sm" c="red" mt="xs">
          {error}
        </Text>
      )}
      <Modal opened={confirm} onClose={() => setConfirm(false)} title="Vider la corbeille">
        <Stack gap="sm">
          <Text size="sm">
            Supprimer définitivement {info?.count} fichier(s) ({mo(info?.bytes ?? 0)}) des dossiers « .organisons-corbeille » de toutes les
            bibliothèques ? Ils ne passent pas par la corbeille de Windows et ne pourront pas être récupérés.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(false)}>
              Annuler
            </Button>
            <Button
              color="red"
              onClick={() => {
                setConfirm(false)
                api
                  .purgeTrash()
                  .then((n) => {
                    setMessage(`${n} fichier(s) supprimé(s) définitivement.`)
                    refresh()
                    onChanged?.()
                  })
                  .catch((e) => setError(String(e)))
              }}
            >
              Supprimer définitivement
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  )
}

/** Taille lisible (Mo avec une décimale, ko en dessous). */
function mo(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${Math.ceil(bytes / 1024)} ko`
}
