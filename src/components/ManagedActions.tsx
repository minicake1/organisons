import { useState } from 'react'
import { Button, Code, Group, Menu, Modal, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { IconArrowsMove, IconChevronDown, IconFileImport } from '@tabler/icons-react'
import { open } from '@tauri-apps/plugin-dialog'
import { api, type Library, type OrganizeReport, type PlannedMove } from '../api'

/** Chemin affiché relativement à la racine de la bibliothèque. */
function rel(path: string, root: string) {
  const r = root.replace(/[\\/]+$/, '')
  return path.toLowerCase().startsWith(r.toLowerCase()) ? path.slice(r.length).replace(/^[\\/]/, '') : path
}

export function reportText(r: OrganizeReport) {
  const parts = []
  if (r.moved) parts.push(`${r.moved} fichier(s) rangé(s)`)
  if (r.imported) parts.push(`${r.imported} fichier(s) importé(s)`)
  if (!parts.length) parts.push('Aucun fichier modifié')
  return parts.join(', ')
}

export interface ActionResult {
  text: string
  errors: string[]
}

/**
 * Boutons « Importer des GPX… » et « Ranger… » des bibliothèques gérées, avec
 * l'aperçu des déplacements. S'il y a plusieurs bibliothèques gérées, chaque
 * bouton ouvre un menu pour choisir laquelle.
 */
export default function ManagedActions({
  libraries,
  onDone,
  size = 'sm',
}: {
  libraries: Library[]
  onDone: (lib: Library, r: ActionResult) => void
  size?: 'xs' | 'sm'
}) {
  const managed = libraries.filter((l) => l.mode === 'managed')
  const [busy, setBusy] = useState<'import' | 'plan' | null>(null)
  const [planFor, setPlanFor] = useState<Library | null>(null)
  const [moves, setMoves] = useState<PlannedMove[]>([])

  if (!managed.length) return null

  const fail = (l: Library, e: unknown) => onDone(l, { text: String(e), errors: [] })

  const importInto = async (l: Library) => {
    const picked = await open({
      multiple: true,
      title: `Importer des GPX dans « ${l.name} »`,
      filters: [{ name: 'Traces GPX', extensions: ['gpx', 'GPX'] }],
    })
    const files = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : []
    if (!files.length) return
    setBusy('import')
    try {
      const r = await api.importFiles(l.id, files)
      onDone(l, { text: reportText(r), errors: r.errors })
    } catch (e) {
      fail(l, e)
    } finally {
      setBusy(null)
    }
  }

  const showPlan = async (l: Library) => {
    setBusy('plan')
    try {
      setMoves(await api.planOrganize(l.id))
      setPlanFor(l)
    } catch (e) {
      fail(l, e)
    } finally {
      setBusy(null)
    }
  }

  const applyPlan = async () => {
    if (!planFor) return
    const l = planFor
    setPlanFor(null)
    setBusy('plan')
    try {
      const r = await api.applyOrganize(l.id, moves)
      onDone(l, { text: reportText(r), errors: r.errors })
    } catch (e) {
      fail(l, e)
    } finally {
      setBusy(null)
    }
  }

  const button = (kind: 'import' | 'plan') => {
    const label = kind === 'import' ? 'Importer des GPX…' : 'Ranger…'
    const icon = kind === 'import' ? <IconFileImport size={16} /> : <IconArrowsMove size={16} />
    const run = kind === 'import' ? importInto : showPlan
    if (managed.length === 1) {
      return (
        <Button size={size} variant="default" leftSection={icon} loading={busy === kind} onClick={() => run(managed[0])}>
          {label}
        </Button>
      )
    }
    return (
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button size={size} variant="default" leftSection={icon} rightSection={<IconChevronDown size={14} />} loading={busy === kind}>
            {label}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{kind === 'import' ? 'Importer dans' : 'Ranger'}</Menu.Label>
          {managed.map((l) => (
            <Menu.Item key={l.id} onClick={() => run(l)}>
              {l.name}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    )
  }

  return (
    <>
      <Group gap="xs" wrap="nowrap">
        {button('import')}
        {button('plan')}
      </Group>
      <Modal opened={planFor !== null} onClose={() => setPlanFor(null)} title={planFor ? `Ranger « ${planFor.name} »` : ''} size="xl">
        {planFor && (
          <Stack gap="sm">
            {moves.length === 0 ? (
              <Text size="sm">Tout est déjà rangé : aucun fichier à déplacer.</Text>
            ) : (
              <>
                <Text size="sm">
                  {moves.length} fichier(s) vont être déplacés dans <Code>{planFor.path}</Code> selon <Code>{planFor.pattern}</Code>. Les dossiers
                  vidés seront supprimés. Rien n'est modifié tant que tu n'as pas validé.
                </Text>
                <ScrollArea.Autosize mah={400}>
                  <Table striped fz="xs" verticalSpacing={4}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Emplacement actuel</Table.Th>
                        <Table.Th>Nouvel emplacement</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {moves.map((m) => (
                        <Table.Tr key={m.traceId}>
                          <Table.Td style={{ wordBreak: 'break-all' }}>{rel(m.from, planFor.path)}</Table.Td>
                          <Table.Td style={{ wordBreak: 'break-all' }}>{rel(m.to, planFor.path)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              </>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPlanFor(null)}>
                {moves.length ? 'Annuler' : 'Fermer'}
              </Button>
              {moves.length > 0 && <Button onClick={applyPlan}>Déplacer {moves.length} fichier(s)</Button>}
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  )
}
