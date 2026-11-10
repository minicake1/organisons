import { useEffect, useState } from 'react'
import { ActionIcon, Anchor, Badge, Button, Checkbox, Group, Modal, Paper, Stack, Switch, Table, TagsInput, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { api, type TagCount } from '../api'

/** Écran Tags : nombre de traces par tag, renommage (fusion) et suppression. */
export default function TagsPage({ onOpenTag }: { onOpenTag: (tag: string) => void }) {
  const [tags, setTags] = useState<TagCount[]>([])
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [editing, setEditing] = useState<TagCount | null>(null)
  const [newName, setNewName] = useState('')
  const [deleting, setDeleting] = useState<TagCount | null>(null)
  const [query, setQuery] = useState('')
  const [created, setCreated] = useState("")
  const [createAuto, setCreateAuto] = useState(true)

  const refresh = () => api.tagCounts().then(setTags).catch((e) => setError(String(e)))
  useEffect(() => {
    refresh()
  }, [])

  const run = async (p: Promise<string[]>) => {
    setError(null)
    try {
      setWarnings(await p)
    } catch (e) {
      setError(String(e))
    }
    refresh()
  }

  const target = tags.find((t) => t.tag === newName.trim() && t.tag !== editing?.tag)
  const shown = tags.filter((t) => t.tag.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <Stack gap="md" maw={1040}>
      <Group>
        <Title order={2} mr="auto">
          Tags
        </Title>
        <TextInput placeholder="Rechercher un tag" value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={240} />
      </Group>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const name = created.trim()
          if (!name) return
          setError(null)
          api
            .createTag(name)
            .then(() => (createAuto ? api.setTagAuto(name, true) : undefined))
            .then(() => {
              setCreated("")
              refresh()
            })
            .catch((err) => setError(String(err)))
        }}
      >
        <Group gap="xs" align="flex-end">
          <TextInput
            label="Nouveau tag"
            description="Proposé dans le champ Tags des fiches ; avec la détection, aussi suggéré sur les traces dont le titre le contient. Aucune trace n’est modifiée."
            placeholder="Ex. BRM 2027"
            value={created}
            onChange={(e) => setCreated(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Checkbox
            label="Détecter dans les titres"
            checked={createAuto}
            onChange={(e) => setCreateAuto(e.currentTarget.checked)}
            mb={8}
          />
          <Button type="submit" disabled={!created.trim()}>
            Créer
          </Button>
        </Group>
      </form>
      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      {warnings.length > 0 && (
        <Paper withBorder p="sm" bg="orange.0">
          <Text size="sm" fw={600}>
            Index à jour, mais {warnings.length} fichier(s) GPX n'ont pas pu être réécrits :
          </Text>
          {warnings.slice(0, 5).map((w, i) => (
            <Text key={i} size="xs">
              {w}
            </Text>
          ))}
        </Paper>
      )}
      <Paper withBorder radius="md">
        {tags.length === 0 ? (
          <Text p="md" c="dimmed" size="sm">
            Aucun tag pour l’instant. Crée-en un ci-dessus, ou depuis la fiche d’une trace.
          </Text>
        ) : (
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tag</Table.Th>
                <Table.Th w={110}>Traces</Table.Th>
                <Table.Th w={150}>
                  <Tooltip label="Proposé sur les traces dont le titre ou les infos du GPX le contiennent (ex. NP# pour « np#614 »)" multiline w={260}>
                    <span>Détection auto</span>
                  </Tooltip>
                </Table.Th>
                <Table.Th>
                  <Tooltip label="Autres mots qui font proposer ce tag (ex. « np# » ou « nantes pédale » pour NP#). En ajouter active la détection." multiline w={280}>
                    <span>Mots-clés de détection</span>
                  </Tooltip>
                </Table.Th>
                <Table.Th w={90} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((t) => (
                <Table.Tr key={t.tag}>
                  <Table.Td>
                    <Anchor component="button" type="button" onClick={() => onOpenTag(t.tag)}>
                      <Badge variant="light" style={{ cursor: 'pointer', textTransform: 'none' }}>
                        {t.tag}
                      </Badge>
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{t.count}</Table.Td>
                  <Table.Td>
                    <Switch
                      size="sm"
                      aria-label={`Détecter ${t.tag} automatiquement`}
                      checked={t.auto}
                      onChange={(e) => {
                        const auto = e.currentTarget.checked
                        setTags((ts) => ts.map((x) => (x.tag === t.tag ? { ...x, auto } : x)))
                        // Rechargé : le nom du tag apparaît dans ses mots-clés à l’activation.
                        api.setTagAuto(t.tag, auto).then(refresh).catch((err) => {
                          setError(String(err))
                          refresh()
                        })
                      }}
                    />
                  </Table.Td>
                  <Table.Td>
                    <TagsInput
                      size="xs"
                      aria-label={`Mots-clés de détection de ${t.tag}`}
                      placeholder={t.keywords.length ? '' : 'Ajouter un mot-clé'}
                      value={t.keywords}
                      onChange={(keywords) => {
                        setTags((ts) => ts.map((x) => (x.tag === t.tag ? { ...x, keywords, auto: x.auto || keywords.length > x.keywords.length } : x)))
                        api.setTagKeywords(t.tag, keywords).then(refresh).catch((err) => {
                          setError(String(err))
                          refresh()
                        })
                      }}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Renommer ou fusionner">
                        <ActionIcon
                          variant="subtle"
                          aria-label={`Renommer ${t.tag}`}
                          onClick={() => {
                            setEditing(t)
                            setNewName(t.tag)
                          }}
                        >
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Retirer ce tag de toutes les traces">
                        <ActionIcon variant="subtle" color="red" aria-label={`Supprimer ${t.tag}`} onClick={() => setDeleting(t)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={`Renommer « ${editing?.tag ?? ''} »`}>
        <Stack gap="sm">
          <TextInput label="Nouveau nom" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} data-autofocus />
          {target && (
            <Text size="sm" c="orange.8">
              Le tag « {target.tag} » existe déjà : les deux seront fusionnés ({(editing?.count ?? 0) + target.count} traces au plus).
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditing(null)}>
              Annuler
            </Button>
            <Button
              disabled={!newName.trim() || newName.trim() === editing?.tag}
              onClick={() => {
                if (editing) run(api.renameTag(editing.tag, newName.trim()))
                setEditing(null)
              }}
            >
              {target ? 'Fusionner' : 'Renommer'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Supprimer le tag">
        <Stack gap="sm">
          <Text size="sm">
            Retirer « {deleting?.tag} » de {deleting?.count} trace(s) ? Les traces elles-mêmes ne sont pas supprimées.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>
              Annuler
            </Button>
            <Button
              color="red"
              onClick={() => {
                if (deleting) run(api.deleteTag(deleting.tag))
                setDeleting(null)
              }}
            >
              Retirer le tag
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
