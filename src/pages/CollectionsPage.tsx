import { useEffect, useState } from 'react'
import { ActionIcon, Button, Group, Modal, Paper, Stack, Switch, Table, Text, TextInput, Title, Tooltip, UnstyledButton } from '@mantine/core'
import { IconFolder, IconPencil, IconPlus, IconRoute, IconTrash } from '@tabler/icons-react'
import { api, type Collection } from '../api'

/**
 * Écran Collections : listes nommées de traces (« BRM 2027 », « Séjour Vercors »…).
 * Une trace peut être dans plusieurs collections ; on l'y range depuis sa fiche.
 */
export default function CollectionsPage({ onOpenCollection }: { onOpenCollection: (c: Collection) => void }) {
  const [list, setList] = useState<Collection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<Collection | null>(null)
  const [newName, setNewName] = useState('')
  const [deleting, setDeleting] = useState<Collection | null>(null)

  const refresh = () => api.collections().then(setList).catch((e) => setError(String(e)))
  useEffect(() => {
    refresh()
  }, [])

  const act = (p: Promise<unknown>) => {
    setError(null)
    p.then(refresh).catch((e) => setError(String(e)))
  }

  return (
    <Stack gap="md" maw={760}>
      <Title order={2}>Collections</Title>
      <Paper withBorder radius="md" p="md">
        {/* Un vrai <form> : Group de Mantine 7 n'accepte pas component="form". */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            act(api.createCollection(name.trim()).then(() => setName('')))
          }}
        >
          <Group align="flex-end">
            <TextInput label="Nouvelle collection" placeholder="Ex. BRM 2027" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
            <Button type="submit" leftSection={<IconPlus size={16} />} disabled={!name.trim()}>
              Créer
            </Button>
          </Group>
        </form>
      </Paper>
      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      <Paper withBorder radius="md">
        {list.length === 0 ? (
          <Text p="md" c="dimmed" size="sm">
            Aucune collection. Crée-en une, puis ajoute des traces depuis leur fiche ou par lot depuis la Bibliothèque. Une collection peut devenir un tour (étapes).
          </Text>
        ) : (
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Collection</Table.Th>
                <Table.Th w={110}>Traces</Table.Th>
                <Table.Th w={110}>
                  <Tooltip label="Un tour regroupe ses traces en étapes : carte, profil et chiffres de l’ensemble ou d’une étape." multiline w={260}>
                    <span>Tour</span>
                  </Tooltip>
                </Table.Th>
                <Table.Th w={90} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    <UnstyledButton onClick={() => onOpenCollection(c)}>
                      <Group gap="xs">
                        {c.isTour ? <IconRoute size={16} color="#e8590c" /> : <IconFolder size={16} color="#4263eb" />}
                        <Text fw={500} c="blue.8">
                          {c.name}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  </Table.Td>
                  <Table.Td>{c.count}</Table.Td>
                  <Table.Td>
                    <Switch
                      size="sm"
                      aria-label={`${c.name} est un tour`}
                      checked={c.isTour}
                      onChange={(e) => act(api.setCollectionTour(c.id, e.currentTarget.checked))}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Renommer">
                        <ActionIcon
                          variant="subtle"
                          aria-label={`Renommer ${c.name}`}
                          onClick={() => {
                            setEditing(c)
                            setNewName(c.name)
                          }}
                        >
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Supprimer la collection (pas les traces)">
                        <ActionIcon variant="subtle" color="red" aria-label={`Supprimer ${c.name}`} onClick={() => setDeleting(c)}>
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

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title="Renommer la collection">
        <Stack gap="sm">
          <TextInput label="Nom" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} data-autofocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditing(null)}>
              Annuler
            </Button>
            <Button
              disabled={!newName.trim()}
              onClick={() => {
                if (editing) act(api.renameCollection(editing.id, newName.trim()))
                setEditing(null)
              }}
            >
              Renommer
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Supprimer la collection">
        <Stack gap="sm">
          <Text size="sm">
            Supprimer « {deleting?.name} » ? Ses {deleting?.count} trace(s) restent dans la bibliothèque.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>
              Annuler
            </Button>
            <Button
              color="red"
              onClick={() => {
                if (deleting) act(api.deleteCollection(deleting.id))
                setDeleting(null)
              }}
            >
              Supprimer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
