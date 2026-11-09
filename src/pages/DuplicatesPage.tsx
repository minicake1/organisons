import { useEffect, useState } from 'react'
import { Anchor, Badge, Button, Code, Group, Loader, Modal, Paper, Select, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconFolderOpen } from '@tabler/icons-react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { api, type DuplicateSet, type Library, type SetAsideInfo, type TraceSummary } from '../api'
import { date, int, km1 } from '../labels'

/**
 * Écran Doublons. C'est toujours l'utilisateur qui décide : rien n'est
 * supprimé, un doublon « mis de côté » part dans le dossier caché
 * `.organisons-doublons` de sa bibliothèque.
 */
export default function DuplicatesPage({ onOpen, onChanged }: { onOpen: (id: number) => void; onChanged: () => void }) {
  const [sets, setSets] = useState<DuplicateSet[] | null>(null)
  const [libraries, setLibraries] = useState<Library[]>([])
  const [error, setError] = useState<string | null>(null)
  const [aside, setAside] = useState<TraceSummary | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [info, setInfo] = useState<SetAsideInfo | null>(null)
  const [purgeDays, setPurgeDays] = useState(0)
  const [confirmPurge, setConfirmPurge] = useState(false)

  const refresh = () => {
    api
      .duplicateSets()
      .then(setSets)
      .catch((e) => setError(String(e)))
    api.setAsideInfo().then(setInfo).catch(() => {})
    onChanged()
  }
  useEffect(() => {
    refresh()
    api.listLibraries().then(setLibraries).catch(() => {})
    api.getPurgeDays().then(setPurgeDays).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const libName = (id: number) => libraries.find((l) => l.id === id)?.name ?? ''
  const act = (p: Promise<unknown>, message?: string) => {
    setError(null)
    p.then(() => {
      if (message) setDone(message)
      refresh()
    }).catch((e) => setError(String(e)))
  }

  if (!sets) return <Loader />

  return (
    <Stack gap="md" maw={1100}>
      <Title order={2}>Doublons</Title>
      <Text size="sm" c="dimmed">
        <b>Identiques</b> : même fichier, octet pour octet. <b>Probables</b> : même parcours (distance, dénivelé, départ et arrivée), par exemple une trace
        réexportée depuis Komoot. Rien n'est supprimé : « Mettre de côté » range le fichier dans le dossier caché <Code>.organisons-doublons</Code> de sa
        bibliothèque.
      </Text>
      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      {done && (
        <Text c="teal.8" size="sm">
          {done}
        </Text>
      )}
      <Paper withBorder radius="md" p="md">
        <Group gap="md" align="flex-end" wrap="wrap">
          <Stack gap={2} style={{ flex: '1 1 260px' }}>
            <Text fw={600} size="sm">
              Doublons mis de côté
            </Text>
            <Text size="sm" c="dimmed">
              {info && info.count > 0
                ? `${info.count} fichier(s), ${mo(info.bytes)}${info.oldest ? `, le plus ancien mis de côté le ${date(info.oldest)}` : ''}`
                : 'Aucun fichier mis de côté.'}
            </Text>
          </Stack>
          <Select
            label="Supprimer automatiquement"
            w={220}
            allowDeselect={false}
            data={[
              { value: '0', label: 'Jamais' },
              { value: '7', label: 'Après 7 jours' },
              { value: '14', label: 'Après 14 jours' },
              { value: '30', label: 'Après 30 jours' },
            ]}
            value={String(purgeDays)}
            onChange={(v) => {
              const days = Number(v ?? 0)
              setPurgeDays(days)
              act(api.setPurgeDays(days))
            }}
          />
          <Button color="red" variant="light" disabled={!info?.count} onClick={() => setConfirmPurge(true)}>
            Vider maintenant
          </Button>
        </Group>
      </Paper>

      {sets.length === 0 && (
        <Paper withBorder radius="md" p="md">
          <Text size="sm">Aucun doublon dans la bibliothèque.</Text>
        </Paper>
      )}
      {sets.map((s) => (
        <Paper key={s.traces.map((t) => t.id).join('-')} withBorder radius="md">
          <Group p="sm" gap="xs" style={{ borderBottom: '1px solid #f1f3f5' }}>
            <Badge color={s.kind === 'identical' ? 'orange' : 'yellow'} variant="light">
              {s.kind === 'identical' ? 'Identiques' : 'Doublon probable'}
            </Badge>
            <Text fw={600} size="sm">
              {s.traces[0].name}
            </Text>
            <Text size="sm" c="dimmed">
              {km1(s.traces[0].distanceKm)} km · {int(s.traces[0].elevationGain)} m D+ · {s.traces.length} fichiers
            </Text>
            <Tooltip label="Ne plus proposer ces traces comme doublons">
              <Button ml="auto" size="xs" variant="subtle" onClick={() => act(api.markNotDuplicates(s.traces.map((t) => t.id)))}>
                Ce ne sont pas des doublons
              </Button>
            </Tooltip>
          </Group>
          <Table verticalSpacing={6} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fichier</Table.Th>
                <Table.Th w={140}>Bibliothèque</Table.Th>
                <Table.Th w={90}>Source</Table.Th>
                <Table.Th w={100}>Ajoutée le</Table.Th>
                <Table.Th w={120}>Tags</Table.Th>
                <Table.Th w={250} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {s.traces.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td style={{ wordBreak: 'break-all' }}>
                    <Anchor size="sm" onClick={() => onOpen(t.id)}>
                      {t.path}
                    </Anchor>
                    {s.kind === 'probable' && (
                      <Text size="xs" c="dimmed">
                        {t.name} · {km1(t.distanceKm)} km · {int(t.elevationGain)} m
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{libName(t.libraryId)}</Table.Td>
                  <Table.Td>{t.source === 'komoot' ? 'Komoot' : 'Fichier'}</Table.Td>
                  <Table.Td>{date(t.addedAt)}</Table.Td>
                  <Table.Td>{t.tags.join(', ')}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Button size="xs" variant="default" leftSection={<IconFolderOpen size={14} />} onClick={() => revealItemInDir(t.path)}>
                        Dossier
                      </Button>
                      <Button size="xs" variant="light" color="orange" onClick={() => setAside(t)}>
                        Mettre de côté
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      ))}

      <Modal opened={confirmPurge} onClose={() => setConfirmPurge(false)} title="Vider les doublons mis de côté">
        <Stack gap="sm">
          <Text size="sm">
            Supprimer définitivement {info?.count} fichier(s) ({mo(info?.bytes ?? 0)}) des dossiers « .organisons-doublons » de toutes les bibliothèques ?
            Ils ne passent pas par la corbeille et ne pourront pas être récupérés.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmPurge(false)}>
              Annuler
            </Button>
            <Button
              color="red"
              onClick={() => {
                setConfirmPurge(false)
                act(api.purgeSetAside().then((n) => setDone(`${n} fichier(s) supprimé(s) définitivement.`)))
              }}
            >
              Supprimer définitivement
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={aside !== null} onClose={() => setAside(null)} title="Mettre ce doublon de côté">
        <Stack gap="sm">
          <Text size="sm">Le fichier sera déplacé dans le dossier caché « .organisons-doublons » de sa bibliothèque et retiré de l'appli :</Text>
          <Code block>{aside?.path}</Code>
          <Text size="sm">Ses tags, notes et collections dans l'appli seront perdus. Le fichier, lui, reste récupérable dans ce dossier.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAside(null)}>
              Annuler
            </Button>
            <Button
              color="orange"
              onClick={() => {
                if (aside) act(api.setAsideDuplicate(aside.id).then((p) => setDone(`Fichier mis de côté : ${p}`)))
                setAside(null)
              }}
            >
              Mettre de côté
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}

/** Taille lisible (Mo avec une décimale, ko en dessous). */
function mo(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${Math.ceil(bytes / 1024)} ko`
}
