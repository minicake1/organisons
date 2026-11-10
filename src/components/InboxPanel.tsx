import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, CloseButton, Group, Paper, Select, Stack, Text, Tooltip } from '@mantine/core'
import { IconDownload, IconReplace } from '@tabler/icons-react'
import { api, type Inbox, type InboxItem, type Library } from '../api'

/** Demande une relecture du dossier surveillé (après une ouverture dans gpx.studio). */
export const INBOX_EVENT = 'organisons:inbox'
/** Une trace a été remplacée : sa fiche se recharge. */
export const TRACE_CHANGED_EVENT = 'organisons:trace-changed'

/**
 * Bandeau des GPX arrivés dans le dossier surveillé (Téléchargements par défaut) :
 * version modifiée dans gpx.studio à remettre à la place de la trace, ou nouveau
 * GPX à ajouter à une bibliothèque gérée. Rien n'est fait sans un clic.
 */
export default function InboxPanel({ onOpen }: { onOpen: (id: number) => void }) {
  const [inbox, setInbox] = useState<Inbox | null>(null)
  const [libraries, setLibraries] = useState<Library[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean; traceId?: number } | null>(null)

  const refresh = useCallback(() => {
    api.inboxList().then(setInbox).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    api
      .listLibraries()
      .then((l) => {
        const managed = l.filter((x) => x.mode === 'managed')
        setLibraries(managed)
        setTarget((t) => t ?? (managed[0] ? String(managed[0].id) : null))
      })
      .catch(() => {})
    window.addEventListener('focus', refresh)
    window.addEventListener(INBOX_EVENT, refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener(INBOX_EVENT, refresh)
    }
  }, [refresh])

  // Retour attendu de gpx.studio : on regarde toutes les 5 s, sinon toutes les minutes.
  const waiting = inbox?.waiting ?? false
  useEffect(() => {
    const t = setInterval(refresh, waiting ? 5_000 : 60_000)
    return () => clearInterval(t)
  }, [refresh, waiting])

  const items = inbox?.items ?? []
  const libName = useMemo(() => libraries.find((l) => String(l.id) === target)?.name, [libraries, target])

  const run = async (item: InboxItem, label: string, p: () => Promise<{ text: string; traceId?: number }>) => {
    setBusy(item.path + label)
    setMessage(null)
    try {
      setMessage(await p())
    } catch (e) {
      setMessage({ text: String(e), error: true })
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const replace = (item: InboxItem) =>
    run(item, 'replace', async () => {
      const id = item.editOf!.traceId
      await api.inboxReplace(item.path, id)
      window.dispatchEvent(new CustomEvent(TRACE_CHANGED_EVENT, { detail: id }))
      return { text: `« ${item.editOf!.name} » remplacée par la version de gpx.studio. L’ancienne version est dans la Corbeille.`, traceId: id }
    })
  const add = (item: InboxItem) =>
    run(item, 'add', async () => {
      const r = await api.inboxImport([item.path], Number(target))
      if (r.errors.length) throw r.errors[0]
      return { text: `« ${item.check.name} » ajoutée à ${libName}.`, traceId: r.importedIds[0] }
    })
  const dismiss = (item: InboxItem) => run(item, 'dismiss', async () => ((await api.inboxDismiss([item.path])), { text: '' }))

  if (!items.length && !message?.text) return null

  return (
    <Paper withBorder radius="md" p="sm" mb="md" bg="var(--mantine-color-indigo-light)">
      <Stack gap="xs">
        <Group gap="xs">
          <IconDownload size={16} />
          <Text size="sm" fw={600}>
            {items.length ? `${items.length} GPX arrivé(s) dans ${inbox?.dir}` : 'Dossier surveillé'}
          </Text>
          {items.some((i) => !i.editOf) && libraries.length > 0 && (
            <Select
              ml="auto"
              size="xs"
              w={220}
              data={libraries.map((l) => ({ value: String(l.id), label: `Ajouter à : ${l.name}` }))}
              value={target}
              onChange={setTarget}
              allowDeselect={false}
            />
          )}
        </Group>
        {items.slice(0, 5).map((item) => (
          <Group key={item.path} gap="xs" wrap="nowrap">
            <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" lineClamp={1}>
                {item.check.name} <Text span size="xs" c="dimmed">({item.file})</Text>
              </Text>
              {item.editOf ? (
                <Text size="xs" c="var(--mantine-color-indigo-light-color)">
                  Version modifiée de « {item.editOf.name} » (gpx.studio)
                </Text>
              ) : item.check.status === 'probable' ? (
                <Text size="xs" c="var(--mantine-color-orange-light-color)" lineClamp={1}>
                  Ressemble à : {item.check.matches.join(', ')}
                </Text>
              ) : item.check.status === 'error' ? (
                <Text size="xs" c="red" lineClamp={1}>
                  {item.check.error}
                </Text>
              ) : null}
            </Stack>
            {item.editOf && (
              <Tooltip
                label="Cette bibliothèque n’autorise pas la modification des GPX (Réglages) : ajoute plutôt la version comme nouvelle trace."
                disabled={item.editOf.canReplace}
                multiline
                w={280}
              >
                <Button
                  size="compact-sm"
                  leftSection={<IconReplace size={14} />}
                  disabled={!item.editOf.canReplace || busy != null}
                  loading={busy === item.path + 'replace'}
                  onClick={() => replace(item)}
                >
                  Remplacer la trace
                </Button>
              </Tooltip>
            )}
            {item.check.status !== 'error' && (
              <Tooltip label="Aucune bibliothèque gérée : Organisons ne copie des fichiers que dans une bibliothèque gérée." disabled={libraries.length > 0}>
                <Button
                  size="compact-sm"
                  variant={item.editOf ? 'default' : 'filled'}
                  disabled={!target || busy != null}
                  loading={busy === item.path + 'add'}
                  onClick={() => add(item)}
                >
                  {item.editOf ? 'Ajouter comme nouvelle' : `Ajouter${libName ? ` à ${libName}` : ''}`}
                </Button>
              </Tooltip>
            )}
            <Button size="compact-sm" variant="subtle" color="gray" disabled={busy != null} onClick={() => dismiss(item)}>
              Ignorer
            </Button>
          </Group>
        ))}
        {items.length > 5 && (
          <Text size="xs" c="dimmed">
            Et {items.length - 5} autre(s), affichés après ceux-ci.
          </Text>
        )}
        {message?.text && (
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" c={message.error ? 'red' : 'teal.9'} style={{ flex: 1 }}>
              {message.text}
            </Text>
            {message.traceId != null && !message.error && (
              <Button size="compact-sm" variant="light" onClick={() => onOpen(message.traceId!)}>
                Ouvrir la fiche
              </Button>
            )}
            <CloseButton size="sm" onClick={() => setMessage(null)} />
          </Group>
        )}
      </Stack>
    </Paper>
  )
}
