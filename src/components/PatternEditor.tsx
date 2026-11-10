import { useEffect, useState } from 'react'
import { Badge, Button, Code, Group, Stack, Text, TextInput } from '@mantine/core'
import { api, type Library } from '../api'

const VARS: { v: string; label: string }[] = [
  { v: '{sport}', label: 'sport' },
  { v: '{année}', label: 'année' },
  { v: '{mois}', label: 'mois' },
  { v: '{source}', label: 'source' },
  { v: '{collection}', label: 'collection' },
  { v: '{nom}', label: 'nom' },
]
const DEFAULT = '{sport}/{année}/{nom}.gpx'

/**
 * Modèle de rangement d'une bibliothèque gérée : champ, variables à insérer
 * et exemple du chemin obtenu. Rien ne bouge avant « Ranger » (aperçu).
 */
export default function PatternEditor({ library, onSaved }: { library: Library; onSaved: () => void }) {
  const saved = library.pattern.replace('{annee}', '{année}') || DEFAULT
  const [value, setValue] = useState(saved)
  const [example, setExample] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDone(false)
    const t = setTimeout(() => {
      api
        .previewPattern(value)
        .then((ex) => {
          setExample(ex)
          setError(null)
        })
        .catch((e) => {
          setExample(null)
          setError(String(e))
        })
    }, 250)
    return () => clearTimeout(t)
  }, [value])

  const save = async () => {
    setBusy(true)
    try {
      await api.setLibraryPattern(library.id, value)
      setDone(true)
      onSaved()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap={6}>
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <TextInput
          label="Modèle de rangement"
          size="xs"
          style={{ flex: 1 }}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          error={error}
        />
        <Button size="xs" variant="default" onClick={() => setValue(DEFAULT)} disabled={value === DEFAULT}>
          Par défaut
        </Button>
        <Button size="xs" onClick={save} loading={busy} disabled={!!error || value === saved}>
          Enregistrer
        </Button>
      </Group>
      <Group gap={4}>
        <Text size="xs" c="dimmed">
          Variables :
        </Text>
        {VARS.map((x) => (
          <Badge
            key={x.v}
            variant="light"
            color="gray"
            tt="none"
            style={{ cursor: 'pointer' }}
            onClick={() => setValue((s) => s + x.v)}
            title={`Ajouter ${x.v} à la fin`}
          >
            {x.v}
          </Badge>
        ))}
      </Group>
      {example && (
        <Text size="xs" c="dimmed">
          Exemple : <Code>{example}</Code>
        </Text>
      )}
      {done && (
        <Text size="xs" c="var(--mantine-color-green-light-color)">
          Modèle enregistré. Utilise « Ranger » pour voir les déplacements prévus : rien ne bouge sans ta validation.
        </Text>
      )}
    </Stack>
  )
}
