import { useState, type CSSProperties, type MouseEvent } from 'react'
import { ActionIcon, Button, Code, Group, Modal, Stack, Text, Tooltip } from '@mantine/core'
import { IconTrash, IconX } from '@tabler/icons-react'
import { api } from '../api'

/**
 * Supprimer une trace : après confirmation, son GPX part dans la corbeille
 * d'Organisons (`.organisons-corbeille` de sa bibliothèque), récupérable
 * jusqu'au vidage, et la trace sort de la bibliothèque.
 */
export default function TrashButton({
  trace,
  onTrashed,
  look = 'icon',
  style,
}: {
  trace: { id: number; name: string }
  onTrashed: () => void
  /** « cross » : croix sur une tuile ; « icon » : corbeille en bout de ligne ; « button » : bouton de la fiche. */
  look?: 'cross' | 'icon' | 'button'
  style?: CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = (e: MouseEvent) => {
    // Le clic ne doit pas ouvrir la fiche (tuile ou ligne cliquable).
    e.stopPropagation()
    setError(null)
    setOpen(true)
  }

  const confirm = async () => {
    setBusy(true)
    try {
      await api.trashTrace(trace.id)
      setOpen(false)
      onTrashed()
      // Pour le compteur de l’onglet Corbeille.
      window.dispatchEvent(new Event("organisons:corbeille"))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const label = `Supprimer « ${trace.name} »`
  return (
    <>
      {look === 'button' ? (
        <Button variant="default" color="red" leftSection={<IconTrash size={16} />} onClick={ask}>
          Supprimer
        </Button>
      ) : (
        <Tooltip label="Mettre à la corbeille">
          <ActionIcon
            variant={look === 'cross' ? 'white' : 'subtle'}
            color={look === 'cross' ? 'dark' : 'red'}
            radius="xl"
            size={look === 'cross' ? 'md' : 'sm'}
            aria-label={label}
            onClick={ask}
            className="trash-faded"
            style={look === 'cross' ? { boxShadow: '0 1px 3px rgba(0,0,0,.3)', ...style } : style}
          >
            {look === 'cross' ? <IconX size={16} /> : <IconTrash size={16} />}
          </ActionIcon>
        </Tooltip>
      )}
      <Modal opened={open} onClose={() => setOpen(false)} title="Mettre la trace à la corbeille ?" onClick={(e) => e.stopPropagation()}>
        <Stack gap="sm">
          <Text size="sm">
            <b>{trace.name}</b> sort de la bibliothèque. Son fichier GPX est déplacé dans le dossier <Code>.organisons-corbeille</Code> de sa
            bibliothèque : il reste récupérable dans l'onglet Corbeille jusqu'à son vidage.
          </Text>
          <Text size="xs" c="dimmed">
            Ses tags, notes et collections sont perdus ; s'ils sont écrits dans le GPX, ils reviendront avec le fichier.
          </Text>
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button color="red" loading={busy} onClick={confirm}>
              Mettre à la corbeille
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
