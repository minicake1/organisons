import { useState } from 'react'
import { Badge, Button, Checkbox, Code, Group, Menu, Modal, Paper, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { IconArrowsMove, IconChevronDown, IconFileImport } from '@tabler/icons-react'
import { open } from '@tauri-apps/plugin-dialog'
import { api, type ImportCheck, type Library, type OrganizeReport, type PlannedMove, type TraceDetail } from '../api'
import TagSuggestions from './TagSuggestions'

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
  const [importFor, setImportFor] = useState<Library | null>(null)
  const [checks, setChecks] = useState<ImportCheck[]>([])
  const [chosen, setChosen] = useState<Record<string, boolean>>({})
  const [hints, setHints] = useState<TraceDetail[]>([])

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
      // Fichiers déjà présents (identiques ou même parcours) : on demande avant de copier.
      const found = await api.checkImport(files)
      if (found.every((c) => c.status === 'new')) await runImport(l, files)
      else {
        setChecks(found)
        setChosen(Object.fromEntries(found.map((c) => [c.file, c.status === 'new'])))
        setImportFor(l)
      }
    } catch (e) {
      fail(l, e)
    } finally {
      setBusy(null)
    }
  }

  const runImport = async (l: Library, files: string[]) => {
    const r = await api.importFiles(l.id, files)
    onDone(l, { text: reportText(r), errors: r.errors })
    await proposeTags(r.importedIds)
  }

  /** Ouvre la fenêtre des tags proposés pour ces traces (s’il y en a). */
  const proposeTags = async (ids: number[]) => {
    const details = await Promise.all(ids.map((id) => api.getTrace(id).catch(() => null)))
    const withHints = details.filter((t): t is TraceDetail => !!t && t.tagSuggestions.length > 0)
    if (withHints.length) setHints(withHints)
  }

  const confirmImport = async () => {
    if (!importFor) return
    const l = importFor
    const files = checks.filter((c) => chosen[c.file]).map((c) => c.file)
    setImportFor(null)
    if (!files.length) return
    setBusy('import')
    try {
      await runImport(l, files)
    } catch (e) {
      fail(l, e)
    } finally {
      setBusy(null)
    }
  }

  const updateHint = (id: number, change: (t: TraceDetail) => TraceDetail) =>
    setHints((hs) => hs.map((t) => (t.id === id ? change(t) : t)))

  // Validation des tags proposés : pour une trace, ou par lot (un tag sur toutes les traces, ou tout).
  const addTags = (t: TraceDetail, add: string[]) => {
    const tags = [...t.tags, ...add.filter((a) => !t.tags.some((x) => x.toLowerCase() === a.toLowerCase()))]
    updateHint(t.id, (x) => ({ ...x, tags, tagSuggestions: x.tagSuggestions.filter((s) => !add.includes(s)) }))
    api.setTags(t.id, tags).catch(() => {})
  }
  const ignoreTags = (t: TraceDetail, ign: string[]) => {
    updateHint(t.id, (x) => ({ ...x, tagSuggestions: x.tagSuggestions.filter((s) => !ign.includes(s)) }))
    api.ignoreTagSuggestions(t.id, ign).catch(() => {})
  }
  /** `tag` absent : tous les tags proposés de toutes les traces. */
  const batch = (mode: "add" | "ignore", tag?: string) =>
    hints.forEach((t) => {
      const sel = t.tagSuggestions.filter((s) => tag === undefined || s === tag)
      if (sel.length) (mode === "add" ? addTags : ignoreTags)(t, sel)
    })
  const byTag = Array.from(
    hints.reduce((m, t) => {
      t.tagSuggestions.forEach((s) => m.set(s, (m.get(s) ?? 0) + 1))
      return m
    }, new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

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
      // Comme après un import : tags proposés pour les traces rangées.
      await proposeTags(moves.map((m) => m.traceId))
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
      <Modal opened={importFor !== null} onClose={() => setImportFor(null)} title={importFor ? `Importer dans « ${importFor.name} »` : ''} size="xl">
        <Stack gap="sm">
          <Text size="sm">
            Certains fichiers semblent déjà être dans la bibliothèque. Coche ceux à importer quand même : rien n'est copié avant
            ta validation.
          </Text>
          <ScrollArea.Autosize mah={420}>
            <Table fz="sm" verticalSpacing={6}>
              <Table.Tbody>
                {checks.map((c) => (
                  <Table.Tr key={c.file}>
                    <Table.Td w={36}>
                      <Checkbox
                        aria-label={`Importer ${c.name}`}
                        checked={!!chosen[c.file]}
                        disabled={c.status === 'error'}
                        onChange={(e) => {
                          const v = e.currentTarget.checked
                          setChosen((s) => ({ ...s, [c.file]: v }))
                        }}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {c.name}
                      </Text>
                      {c.matches.length > 0 && (
                        <Text size="xs" c="dimmed">
                          Déjà présent : {c.matches.slice(0, 3).join(', ')}
                          {c.matches.length > 3 ? ` (+${c.matches.length - 3})` : ''}
                        </Text>
                      )}
                      {c.error && (
                        <Text size="xs" c="red">
                          {c.error}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td w={190}>
                      {c.status === 'new' && (
                        <Badge color="green" variant="light">
                          Nouveau
                        </Badge>
                      )}
                      {c.status === 'identical' && (
                        <Badge color="red" variant="light">
                          Fichier identique
                        </Badge>
                      )}
                      {c.status === 'probable' && (
                        <Badge color="orange" variant="light">
                          Même parcours probable
                        </Badge>
                      )}
                      {c.status === 'error' && (
                        <Badge color="gray" variant="light">
                          Illisible
                        </Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setImportFor(null)}>
              Annuler
            </Button>
            <Button onClick={confirmImport} disabled={!checks.some((c) => chosen[c.file])}>
              Importer {checks.filter((c) => chosen[c.file]).length} fichier(s)
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={hints.length > 0} onClose={() => setHints([])} title="Tags proposés" size="xl">
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Détectés dans le titre et les informations des GPX. Rien n'est ajouté sans ton clic : par lot ci-dessous, ou trace par trace.
          </Text>
          {byTag.length > 0 && (
            <Paper withBorder radius="md" p="sm">
              <Text size="sm" fw={600} mb={6}>
                Par tag
              </Text>
              <Stack gap={6}>
                {byTag.map(([tag, n]) => (
                  <Group key={tag} gap="xs" wrap="nowrap">
                    <Badge variant="light" tt="none">
                      {tag}
                    </Badge>
                    <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                      {n} trace(s)
                    </Text>
                    <Button size="compact-xs" variant="light" onClick={() => batch('add', tag)}>
                      Ajouter {n > 1 ? `aux ${n} traces` : ''}
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={() => batch('ignore', tag)}>
                      Ignorer
                    </Button>
                  </Group>
                ))}
              </Stack>
            </Paper>
          )}
          <ScrollArea.Autosize mah={360}>
            <Stack gap="sm">
              {hints.map((t) => (
                <Stack key={t.id} gap={4}>
                  <Text size="sm" fw={600}>
                    {t.name}
                  </Text>
                  {t.tags.length > 0 && (
                    <Text size="xs" c="dimmed">
                      Tags : {t.tags.join(', ')}
                    </Text>
                  )}
                  <TagSuggestions label="" suggestions={t.tagSuggestions} onAdd={(add) => addTags(t, add)} onIgnore={(ign) => ignoreTags(t, ign)} />
                  {t.tagSuggestions.length === 0 && (
                    <Text size="xs" c="green.8">
                      Fait.
                    </Text>
                  )}
                </Stack>
              ))}
            </Stack>
          </ScrollArea.Autosize>
          <Group justify="flex-end">
            {byTag.length > 0 && (
              <>
                <Button variant="default" onClick={() => batch('ignore')}>
                  Tout ignorer
                </Button>
                <Button onClick={() => batch('add')}>Tout ajouter</Button>
              </>
            )}
            <Button variant={byTag.length ? 'subtle' : 'filled'} onClick={() => setHints([])}>
              Fermer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
