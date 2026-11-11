import { useEffect, useState } from 'react'
import {
  ActionIcon,
  Button,
  Checkbox,
  Code,
  Group,
  Paper,
  Radio,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
  useMantineColorScheme,
  type MantineColorScheme,
} from '@mantine/core'
import { IconFolderPlus, IconTrash } from '@tabler/icons-react'
import { open } from '@tauri-apps/plugin-dialog'
import { api, type Library, type ScanReport } from '../api'
import ManagedActions, { type ActionResult } from '../components/ManagedActions'
import PatternEditor from '../components/PatternEditor'
import CreditsPanel from '../components/CreditsPanel'
import { UpdateCheck } from '../components/UpdatePanel'
import BackupPanel from '../components/BackupPanel'

export default function SettingsPage() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const [libraries, setLibraries] = useState<Library[]>([])
  const [name, setName] = useState('')
  const [mode, setMode] = useState<Library['mode']>('index')
  const [writeGpx, setWriteGpx] = useState(false)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ScanReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [libReport, setLibReport] = useState<Record<number, ActionResult>>({})

  const refresh = () => api.listLibraries().then(setLibraries).catch((e) => setError(String(e)))
  useEffect(() => {
    refresh()
  }, [])

  const add = async () => {
    const dir = await open({ directory: true, title: 'Dossier de GPX (sur ce PC ou sur le NAS)' })
    if (typeof dir !== 'string') return
    setBusy(true)
    setError(null)
    try {
      const label = name.trim() || dir.split(/[\\/]/).filter(Boolean).pop() || dir
      setReport(await api.addLibrary(label, dir, mode, writeGpx))
      setName('')
      refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  // Passer en bibliothèque gérée autorise Organisons à déplacer les fichiers (« Ranger »,
  // renommage) : toujours confirmé. Aucun fichier ne bouge au moment du changement.
  const changeMode = (l: Library, mode: Library['mode']) => {
    if (mode === l.mode) return
    const ok =
      mode === 'managed'
        ? window.confirm(
            `« ${l.name} » devient une bibliothèque gérée : Organisons pourra y importer des GPX et ranger les fichiers selon un modèle de dossiers (toujours avec un aperçu à valider), et renommer le fichier d'une trace renommée. Rien ne bouge maintenant. Continuer ?`,
          )
        : window.confirm(`« ${l.name} » redevient indexée sur place : Organisons n'y déplacera plus aucun fichier. Continuer ?`)
    if (!ok) return
    api
      .setLibraryMode(l.id, mode)
      .then(refresh)
      .catch((e) => setError(String(e)))
  }

  const toggleWrite = (l: Library, v: boolean) => {
    setLibraries((ls) => ls.map((x) => (x.id === l.id ? { ...x, writeGpx: v } : x)))
    api.setLibraryWriteGpx(l.id, v).catch((e) => {
      setError(String(e))
      refresh()
    })
  }

  return (
    <Stack gap="md" maw={960}>
      <Title order={2}>Apparence</Title>
      <Paper withBorder radius="md" p="md">
        <Group>
          <Text fw={600}>Thème</Text>
          <SegmentedControl
            value={colorScheme}
            onChange={(v) => setColorScheme(v as MantineColorScheme)}
            data={[
              { value: 'light', label: 'Clair' },
              { value: 'dark', label: 'Sombre' },
              { value: 'auto', label: 'Comme Windows' },
            ]}
          />
        </Group>
        <Text size="xs" c="dimmed" mt={6}>
          Les fonds de carte restent clairs, pour que les traces colorées restent lisibles.
        </Text>
      </Paper>

      <Title order={2}>Stockage</Title>

      <Paper withBorder radius="md">
        <Group p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Text fw={600}>Bibliothèques</Text>
        </Group>
        {libraries.length === 0 && (
          <Text p="md" c="dimmed" size="sm">
            Aucun dossier pour l'instant.
          </Text>
        )}
        {libraries.map((l) => (
          <Stack key={l.id} gap="xs" p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
            <Group wrap="nowrap" align="flex-start">
              <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs">
                  <Text fw={600}>{l.name}</Text>
                  <SegmentedControl
                    size="xs"
                    value={l.mode}
                    data={[
                      { value: 'index', label: 'Indexée sur place' },
                      { value: 'managed', label: 'Bibliothèque gérée' },
                    ]}
                    onChange={(v) => changeMode(l, v as Library['mode'])}
                  />
                </Group>
                <Code>{l.path}</Code>
              </Stack>
              <Tooltip label="Retirer de l'appli (les fichiers ne sont pas supprimés)">
                <ActionIcon variant="subtle" color="red" aria-label={`Retirer ${l.name}`} onClick={() => api.removeLibrary(l.id).then(refresh)}>
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Group gap="md">
              <Switch
                size="sm"
                checked={l.writeGpx}
                onChange={(e) => toggleWrite(l, e.currentTarget.checked)}
                label="Écrire les tags et notes dans les fichiers GPX"
                description="Ils restent ainsi attachés au fichier, même copié ailleurs."
              />
              <Group ml="auto">
                <ManagedActions libraries={[l]} size="xs" onDone={(lib, r) => setLibReport((s) => ({ ...s, [lib.id]: r }))} />
              </Group>
            </Group>
            {l.mode === 'managed' && <PatternEditor library={l} onSaved={refresh} />}
            {libReport[l.id] && (
              <Stack gap={2}>
                <Text size="sm">{libReport[l.id].text}</Text>
                {libReport[l.id].errors.map((e, i) => (
                  <Text key={i} size="xs" c="red">
                    {e}
                  </Text>
                ))}
              </Stack>
            )}
          </Stack>
        ))}
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Stack gap="sm">
          <Text fw={600}>Ajouter un dossier</Text>
          <TextInput label="Nom affiché" placeholder="Ex. NAS · Vélo" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Radio.Group
            label="Mode"
            value={mode}
            onChange={(v) => {
              setMode(v as Library['mode'])
              setWriteGpx(v === 'managed')
            }}
          >
            <Stack gap={6} mt={6}>
              <Radio value="index" label="Indexer sur place : l'appli lit les fichiers sans jamais les déplacer" />
              <Radio
                value="managed"
                label="Bibliothèque gérée : rangée selon {sport}/{année}/{nom}.gpx"
                description="Les fichiers importés sont rangés directement ; les fichiers déjà présents ne bougent qu'après validation de l'aperçu « Ranger… »."
              />
            </Stack>
          </Radio.Group>
          <Checkbox
            checked={writeGpx}
            onChange={(e) => setWriteGpx(e.currentTarget.checked)}
            label="Écrire les tags et notes dans les fichiers GPX"
            description="Modifiable ensuite pour chaque bibliothèque."
          />
          <Group>
            <Button leftSection={<IconFolderPlus size={16} />} loading={busy} onClick={add}>
              Choisir le dossier…
            </Button>
            <Text size="xs" c="dimmed">
              Un partage NAS fonctionne s'il est accessible depuis l'explorateur (lecteur réseau ou chemin \\NAS\…).
            </Text>
          </Group>
          {report && (
            <Text size="sm">
              {report.added} ajoutée(s), {report.updated} mise(s) à jour, {report.unchanged} inchangée(s), {report.removed} retirée(s)
              {report.errors.length > 0 && ` · ${report.errors.length} erreur(s)`}
            </Text>
          )}
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Paper>


      <Title order={2} mt="md">Sauvegarde de la configuration</Title>
      <BackupPanel />
      <Title order={2} mt="md">Mises à jour</Title>
      <Paper withBorder radius="md" p="md">
        <UpdateCheck />
      </Paper>
      <Title order={2} mt="md">À propos et crédits</Title>
      <CreditsPanel />
    </Stack>
  )
}
