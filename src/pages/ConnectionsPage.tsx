import { Stack, Tabs, Text, Title } from '@mantine/core'
import { IconBarbell, IconBike, IconDeviceWatch, IconEdit, IconLink, IconRefresh } from '@tabler/icons-react'
import KomootPage from './KomootPage'
import PedalonsPage from './PedalonsPage'
import OpenrunnerPage from './OpenrunnerPage'
import HammerheadPanel from '../components/HammerheadPanel'
import TrainingPlatformsPanel from '../components/TrainingPlatformsPanel'
import InboxFolderPanel from '../components/InboxFolderPanel'

export type ConnectionTab = 'pedalons' | 'komoot' | 'openrunner' | 'karoo' | 'training' | 'gpxstudio'

/**
 * Tous les services reliés à Organisons, au même endroit : agenda Pédalons, sources de traces
 * (Komoot, Openrunner), appareil (Karoo), plateformes d'entraînement et
 * modification dans gpx.studio (dossier surveillé).
 */
export default function ConnectionsPage({
  tab,
  onTab,
  onLibrary,
  onAgenda,
}: {
  tab: ConnectionTab
  onTab: (t: ConnectionTab) => void
  onLibrary: () => void
  onAgenda: () => void
}) {
  return (
    <Stack gap="md">
      <Title order={2}>Connexions</Title>
      <Tabs value={tab} onChange={(v) => v && onTab(v as ConnectionTab)} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="pedalons" leftSection={<IconBike size={16} />}>
            Pédalons
          </Tabs.Tab>
          <Tabs.Tab value="komoot" leftSection={<IconRefresh size={16} />}>
            Komoot
          </Tabs.Tab>
          <Tabs.Tab value="openrunner" leftSection={<IconLink size={16} />}>
            Openrunner
          </Tabs.Tab>
          <Tabs.Tab value="karoo" leftSection={<IconDeviceWatch size={16} />}>
            Karoo (Hammerhead)
          </Tabs.Tab>
          <Tabs.Tab value="training" leftSection={<IconBarbell size={16} />}>
            Entraînement
          </Tabs.Tab>
          <Tabs.Tab value="gpxstudio" leftSection={<IconEdit size={16} />}>
            gpx.studio
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="pedalons" pt="md">
          <PedalonsPage onLibrary={onLibrary} mode="login" onSwitch={onAgenda} />
        </Tabs.Panel>
        <Tabs.Panel value="komoot" pt="md">
          <KomootPage onLibrary={onLibrary} />
        </Tabs.Panel>
        <Tabs.Panel value="openrunner" pt="md">
          <OpenrunnerPage onLibrary={onLibrary} />
        </Tabs.Panel>
        <Tabs.Panel value="karoo" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Envoi des traces et des séances vers le Karoo, par le cloud Hammerhead. Les autres appareils GPS sont
              à l’étude.
            </Text>
            <HammerheadPanel />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="training" pt="md">
          <TrainingPlatformsPanel />
        </Tabs.Panel>
        <Tabs.Panel value="gpxstudio" pt="md">
          <InboxFolderPanel />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
