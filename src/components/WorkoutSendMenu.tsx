import { useEffect, useState } from 'react'
import { Button, Group, Menu, Popover, Stack, Text, TextInput } from '@mantine/core'
import { IconChevronDown, IconSend } from '@tabler/icons-react'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { api, type WorkoutSummary } from '../api'
import { savedZwiftFolder } from './TrainingPlatformsPanel'

const today = () => new Date().toISOString().slice(0, 10)

/**
 * « Envoyer vers… » d'une séance : Karoo (Hammerhead), Zwift (copie dans son
 * dossier), intervals.icu (planifiée à une date), MyWhoosh (son Workout Builder,
 * qui n'a pas d'API : on ouvre le site et le dossier du fichier).
 */
export default function WorkoutSendMenu({
  workout,
  sentToKaroo,
  onSent,
  onMessage,
}: {
  workout: WorkoutSummary
  sentToKaroo: boolean
  onSent: () => void
  onMessage: (text: string, error?: boolean) => void
}) {
  const [karoo, setKaroo] = useState(false)
  const [icu, setIcu] = useState(false)
  const zwift = savedZwiftFolder()
  const [busy, setBusy] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [date, setDate] = useState(today())

  useEffect(() => {
    api
      .hammerheadStatus()
      .then((s) => setKaroo(s.connected))
      .catch(() => {})
    api
      .icuStatus()
      .then((s) => setIcu(s.connected))
      .catch(() => {})
  }, [])

  const run = async (p: () => Promise<string>) => {
    setBusy(true)
    try {
      onMessage(await p())
      onSent()
    } catch (e) {
      onMessage(String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const toKaroo = () =>
    run(async () => {
      const r = await api.hammerheadSendWorkouts([workout.id])
      if (r.errors.length) throw r.errors[0]
      return `« ${workout.name} » ${r.updated ? 'mise à jour' : 'envoyée'} sur Hammerhead : le Karoo la récupère à sa prochaine synchronisation.`
    })
  const toZwift = () =>
    run(async () => {
      const errors = await api.zwiftSend([workout.id], zwift!)
      if (errors.length) throw errors[0]
      return `« ${workout.name} » copiée dans Zwift : elle apparaît dans « Custom Workouts » au prochain lancement de Zwift.`
    })
  const toIcu = () =>
    run(async () => {
      setPlanOpen(false)
      const errors = await api.icuPlan([workout.id], date)
      if (errors.length) throw errors[0]
      return `« ${workout.name} » planifiée le ${new Date(date).toLocaleDateString('fr-FR')} sur intervals.icu.`
    })
  const toMyWhoosh = () =>
    run(async () => {
      await openUrl('https://workout.mywhoosh.com/workouts-library')
      await revealItemInDir(workout.path)
      return 'MyWhoosh n’a pas d’envoi direct : dans son Workout Builder (ouvert dans ton navigateur), importe le .zwo affiché dans l’Explorateur, puis « Export to MyWhoosh ».'
    })

  return (
    <Popover opened={planOpen} onChange={setPlanOpen} position="bottom-end" withinPortal>
      <Popover.Target>
        <div>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button size="xs" leftSection={<IconSend size={14} />} rightSection={<IconChevronDown size={12} />} loading={busy}>
                Envoyer vers…
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item disabled={!karoo} onClick={toKaroo}>
                {sentToKaroo ? 'Karoo : mettre à jour' : 'Karoo (Hammerhead)'}
                {!karoo && <Text size="xs" c="dimmed">À connecter dans Connexions → Karoo</Text>}
              </Menu.Item>
              <Menu.Item disabled={!zwift} onClick={toZwift}>
                Zwift
                {!zwift && <Text size="xs" c="dimmed">Dossier Zwift introuvable (Connexions → Entraînement)</Text>}
              </Menu.Item>
              <Menu.Item disabled={!icu} onClick={() => setPlanOpen(true)}>
                intervals.icu : planifier…
                {!icu && <Text size="xs" c="dimmed">À connecter dans Connexions → Entraînement</Text>}
              </Menu.Item>
              <Menu.Item onClick={toMyWhoosh}>
                MyWhoosh (Workout Builder)
                <Text size="xs" c="dimmed">Ouvre le site et le fichier</Text>
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Planifier sur intervals.icu
          </Text>
          <Group align="flex-end" gap="xs">
            <TextInput type="date" label="Date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
            <Button size="sm" onClick={toIcu} disabled={!date}>
              Planifier
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
