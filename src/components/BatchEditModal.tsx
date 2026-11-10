import { useEffect, useState } from 'react'
import { Button, Checkbox, Divider, Group, Modal, MultiSelect, Select, Stack, TagsInput, Text } from '@mantine/core'
import { api, type Collection, type TraceSummary } from '../api'

/**
 * Modifier plusieurs traces à la fois : ajouter ou retirer des tags, changer le
 * sport, ajouter ou retirer des collections. Ce qui est laissé vide ne change pas.
 */
export default function BatchEditModal({
  opened,
  traces,
  onClose,
  onDone,
}: {
  opened: boolean
  traces: TraceSummary[]
  onClose: () => void
  onDone: (message: string, warnings: string[]) => void
}) {
  const [allTags, setAllTags] = useState<string[]>([])
  const [sports, setSports] = useState<string[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [addTags, setAddTags] = useState<string[]>([])
  const [removeTags, setRemoveTags] = useState<string[]>([])
  const [changeSport, setChangeSport] = useState(false)
  const [sport, setSport] = useState<string | null>(null)
  const [addCols, setAddCols] = useState<string[]>([])
  const [removeCols, setRemoveCols] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened) return
    setAddTags([])
    setRemoveTags([])
    setChangeSport(false)
    setSport(null)
    setAddCols([])
    setRemoveCols([])
    setError(null)
    api.allTags().then(setAllTags).catch(() => {})
    api.sports().then(setSports).catch(() => {})
    api.collections().then(setCollections).catch(() => {})
  }, [opened])

  // Tags présents sur la sélection (ceux qu'on peut retirer).
  const present = Array.from(new Set(traces.flatMap((t) => t.tags))).sort((a, b) => a.localeCompare(b))
  const nothing = !addTags.length && !removeTags.length && !changeSport && !addCols.length && !removeCols.length

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      const warnings = await api.batchEdit(
        traces.map((t) => t.id),
        {
          addTags,
          removeTags,
          changeSport,
          sport: sport || null,
          addCollections: addCols,
          removeCollections: removeCols.map(Number),
        },
      )
      onDone(`${traces.length} trace(s) modifiée(s).`, warnings)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={`Modifier ${traces.length} trace(s)`} size="lg">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Seuls les champs remplis sont appliqués ; le reste ne change pas.
        </Text>

        <Divider label="Tags" labelPosition="left" />
        <TagsInput label="Ajouter les tags" placeholder="Choisir ou taper puis Entrée" data={allTags} value={addTags} onChange={setAddTags} clearable />
        <TagsInput
          label="Retirer les tags"
          placeholder={present.length ? 'Choisir' : 'Aucun tag sur ces traces'}
          data={present}
          value={removeTags}
          onChange={(v) => setRemoveTags(v.filter((x) => present.includes(x)))}
          disabled={!present.length}
          clearable
        />

        <Divider label="Sport" labelPosition="left" />
        <Group align="flex-end" gap="sm">
          <Checkbox label="Changer le sport" checked={changeSport} onChange={(e) => setChangeSport(e.currentTarget.checked)} mb={8} />
          <Select
            style={{ flex: 1 }}
            placeholder="Sport lu dans le GPX"
            description={changeSport && !sport ? 'Vide : chaque trace revient au sport lu dans son GPX.' : undefined}
            data={sports}
            value={sport}
            onChange={setSport}
            clearable
            disabled={!changeSport}
          />
        </Group>

        <Divider label="Collections" labelPosition="left" />
        <TagsInput
          label="Ajouter aux collections"
          description="Une collection qui n'existe pas encore est créée."
          placeholder="Choisir ou taper puis Entrée"
          data={collections.map((c) => c.name)}
          value={addCols}
          onChange={setAddCols}
          clearable
        />
        <MultiSelect
          label="Retirer des collections"
          placeholder="Choisir"
          data={collections.map((c) => ({ value: String(c.id), label: c.name }))}
          value={removeCols}
          onChange={setRemoveCols}
          clearable
        />

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={apply} loading={busy} disabled={nothing}>
            Appliquer à {traces.length} trace(s)
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
