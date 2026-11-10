import { useEffect, useState } from 'react'
import { Button, Code, Group, Loader, Paper, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconRestore } from '@tabler/icons-react'
import { api, type TrashItem } from '../api'
import TrashPanel from '../components/TrashPanel'
import { date } from '../labels'

/**
 * Onglet Corbeille : traces supprimées (GPX dans `.organisons-corbeille`),
 * restaurables une par une, et vidage manuel ou automatique.
 */
export default function TrashPage({ onOpen, onChanged }: { onOpen: (id: number) => void; onChanged: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restored, setRestored] = useState<{ id: number; name: string } | null>(null)

  const refresh = () => {
    api
      .trashList()
      .then(setItems)
      .catch((e) => setError(String(e)))
    onChanged()
  }
  useEffect(refresh, []) // eslint-disable-line react-hooks/exhaustive-deps

  const restore = async (it: TrashItem) => {
    setBusy(it.path)
    setError(null)
    try {
      const id = await api.restoreTrash(it.path)
      setRestored({ id, name: it.name })
      setVersion((v) => v + 1)
      refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Stack gap="md" maw={1100}>
      <Title order={2}>Corbeille</Title>
      <TrashPanel version={version} onChanged={refresh} />
      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      {restored && (
        <Paper withBorder p="sm" bg="teal.0" c="teal.9">
          <Group gap="xs">
            <Text size="sm">
              « {restored.name} » est de retour dans sa bibliothèque (à sa racine : « Ranger » la remettra à sa place).
            </Text>
            <Button size="compact-sm" variant="white" onClick={() => onOpen(restored.id)}>
              Ouvrir la fiche
            </Button>
          </Group>
        </Paper>
      )}
      <Paper withBorder radius="md">
        {items === null ? (
          <Loader m="md" />
        ) : items.length === 0 ? (
          <Text p="md" c="dimmed" size="sm">
            La corbeille est vide.
          </Text>
        ) : (
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Trace</Table.Th>
                <Table.Th>Bibliothèque</Table.Th>
                <Table.Th w={130}>Supprimée le</Table.Th>
                <Table.Th w={90}>Taille</Table.Th>
                <Table.Th w={130} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((it) => (
                <Table.Tr key={it.path}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {it.name}
                    </Text>
                    <Code fz="xs">{it.file}</Code>
                  </Table.Td>
                  <Table.Td>{it.library}</Table.Td>
                  <Table.Td>{it.deletedAt ? date(it.deletedAt) : '—'}</Table.Td>
                  <Table.Td>{ko(it.bytes)}</Table.Td>
                  <Table.Td>
                    <Tooltip label="Remettre la trace dans sa bibliothèque">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconRestore size={14} />}
                        loading={busy === it.path}
                        disabled={busy !== null && busy !== it.path}
                        onClick={() => restore(it)}
                      >
                        Restaurer
                      </Button>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
    </Stack>
  )
}

function ko(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${Math.ceil(bytes / 1024)} ko`
}
