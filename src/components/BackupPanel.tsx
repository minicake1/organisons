import { useEffect, useState } from 'react'
import { Button, Code, Group, List, Modal, NumberInput, Paper, Stack, Switch, Text } from '@mantine/core'
import { IconDeviceFloppy, IconRestore } from '@tabler/icons-react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { api, type AutoBackup, type RestorePreview } from '../api'
import { readUiPrefs, writeUiPrefs } from '../uiPrefs'

const today = () => new Date().toISOString().slice(0, 10)
const when = (unix: number) => new Date(unix * 1000).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Réglages → Sauvegarde : fichier de configuration à exporter et à restaurer
 * (réinstallation, crash, autre PC), et sauvegarde automatique quotidienne.
 */
export default function BackupPanel() {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [restore, setRestore] = useState<{ path: string; preview: RestorePreview } | null>(null)
  const [auto, setAuto] = useState<AutoBackup | null>(null)

  useEffect(() => {
    api.backupAutoGet().then(setAuto).catch(() => {})
  }, [])

  const run = async (label: string, p: () => Promise<string | void>) => {
    setBusy(label)
    setMessage(null)
    try {
      const text = await p()
      if (text) setMessage({ text })
    } catch (e) {
      setMessage({ text: String(e), error: true })
    } finally {
      setBusy(null)
    }
  }

  const exportFile = () =>
    run('export', async () => {
      const path = await save({
        title: 'Enregistrer la sauvegarde de la configuration',
        defaultPath: `organisons-sauvegarde-${today()}.json`,
        filters: [{ name: 'Sauvegarde Organisons', extensions: ['json'] }],
      })
      if (!path) return
      await api.backupExport(path, readUiPrefs())
      return `Sauvegarde enregistrée : ${path}`
    })

  const chooseRestore = () =>
    run('preview', async () => {
      const path = await open({ title: 'Restaurer une sauvegarde', filters: [{ name: 'Sauvegarde Organisons', extensions: ['json'] }] })
      if (typeof path !== 'string') return
      setRestore({ path, preview: await api.backupPreview(path) })
    })

  const doRestore = () =>
    run('restore', async () => {
      if (!restore) return
      const r = await api.backupRestore(restore.path)
      setRestore(null)
      writeUiPrefs(r.ui)
      const parts = [
        `${r.tracesRestored} trace(s) retrouvée(s)`,
        r.tracesMissing ? `${r.tracesMissing} introuvable(s)` : null,
        r.librariesAdded ? `${r.librariesAdded} bibliothèque(s) ajoutée(s)` : null,
        `${r.collections} collection(s)`,
        `${r.tags} tag(s)`,
      ].filter(Boolean)
      if (r.errors.length) throw new Error(`Restauration faite (${parts.join(', ')}), avec des remarques : ${r.errors.join(' / ')}`)
      // Thème et préférences de l'interface : rechargés avec la fenêtre.
      setTimeout(() => window.location.reload(), 2500)
      return `Restauration faite : ${parts.join(', ')}. L'appli se recharge…`
    })

  const saveAuto = (dir: string, keep: number) =>
    run('auto', async () => {
      setAuto(await api.backupAutoSet(dir, keep))
    })
  const chooseAutoDir = () =>
    run('auto', async () => {
      const dir = await open({ directory: true, title: 'Dossier des sauvegardes automatiques (par exemple sur le NAS)' })
      if (typeof dir !== 'string') return
      await api.uiPrefsSync(readUiPrefs())
      setAuto(await api.backupAutoSet(dir, auto?.keep ?? 3))
      const file = await api.backupAutoNow()
      setAuto(await api.backupAutoGet())
      return file ? `Première sauvegarde automatique : ${file}` : undefined
    })

  const p = restore?.preview
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          Un fichier pour retrouver ta configuration après une réinstallation, un crash ou sur un autre PC : bibliothèques et leurs réglages,
          tags (détection, mots-clés), collections et tours, et pour chaque trace le nom et le sport choisis, les tags, les notes et les catégories de POI choisies ; plus le
          thème, la FTP et le dossier Zwift. Les traces sont retrouvées par l’empreinte de leur fichier, même déplacées. Les mots de passe et
          jetons n’y sont jamais : reconnecte Komoot, Hammerhead et intervals.icu après une restauration.
        </Text>
        <Group>
          <Button variant="default" leftSection={<IconDeviceFloppy size={16} />} loading={busy === 'export'} onClick={exportFile}>
            Enregistrer une sauvegarde…
          </Button>
          <Button variant="default" leftSection={<IconRestore size={16} />} loading={busy === 'preview' || busy === 'restore'} onClick={chooseRestore}>
            Restaurer…
          </Button>
        </Group>

        <Stack gap={6}>
          <Switch
            label="Sauvegarde automatique, une fois par jour au lancement"
            checked={!!auto?.dir}
            onChange={(e) => (e.currentTarget.checked ? chooseAutoDir() : saveAuto('', auto?.keep ?? 3))}
          />
          {auto?.dir && (
            <Group align="flex-end">
              <Code style={{ flex: 1 }}>{auto.dir}</Code>
              <Button size="xs" variant="default" onClick={chooseAutoDir}>
                Changer…
              </Button>
              <NumberInput
                size="xs"
                w={150}
                label="Fichiers gardés"
                min={1}
                max={100}
                value={auto.keep}
                onChange={(v) => typeof v === 'number' && saveAuto(auto.dir, v)}
              />
            </Group>
          )}
          {auto?.dir && (
            <Text size="xs" c="dimmed">
              {auto.last ? `Dernière sauvegarde : ${when(auto.last)}.` : 'Pas encore de sauvegarde.'} Les plus anciennes sont supprimées au-delà
              du nombre gardé (seulement les fichiers « organisons-sauvegarde-… » de ce dossier).
            </Text>
          )}
        </Stack>

        {message && (
          <Text size="sm" c={message.error ? 'red' : 'var(--mantine-color-teal-light-color)'}>
            {message.text}
          </Text>
        )}
      </Stack>

      <Modal opened={!!restore} onClose={() => setRestore(null)} title="Restaurer la sauvegarde" size="lg">
        {p && (
          <Stack gap="sm">
            <Text size="sm">
              Sauvegarde du {when(p.createdAt)} (Organisons {p.app}).
            </Text>
            <List size="sm" spacing={4}>
              {p.librariesNew.length > 0 && <List.Item>Bibliothèques ajoutées puis lues : {p.librariesNew.join(', ')}</List.Item>}
              {p.librariesChanged.length > 0 && <List.Item>Bibliothèques dont le mode ou le modèle change : {p.librariesChanged.join(', ')}</List.Item>}
              <List.Item>
                Traces : {p.tracesTotal} avec des données (nom, sport, tags, notes) ;{' '}
                {p.librariesNew.length ? 'elles seront cherchées après la lecture des nouvelles bibliothèques' : `${p.tracesFound} retrouvée(s) maintenant`}
              </List.Item>
              <List.Item>
                {p.collections} collection(s) et tours, {p.tags} tag(s), {p.settings} réglage(s)
              </List.Item>
            </List>
            {p.librariesUnreachable.length > 0 && (
              <Text size="sm" c="orange">
                Injoignables pour l’instant : {p.librariesUnreachable.join(', ')}. Elles seront ajoutées ; restaure à nouveau quand elles seront
                accessibles pour retrouver leurs traces.
              </Text>
            )}
            <Text size="xs" c="dimmed">
              Ce que contient la sauvegarde remplace les données actuelles des traces retrouvées ; rien d’autre n’est supprimé et les fichiers
              GPX ne sont pas modifiés.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setRestore(null)}>
                Annuler
              </Button>
              <Button onClick={doRestore} loading={busy === 'restore'}>
                Restaurer
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Paper>
  )
}
