import { useState } from 'react'
import { AppShell, Badge, Group, NavLink, Stack, Text, ThemeIcon } from '@mantine/core'
import {
  IconBuildingBroadcastTower,
  IconCalendar,
  IconCopy,
  IconDeviceWatch,
  IconFolder,
  IconRefresh,
  IconRoute,
  IconSettings,
  IconStack2,
  IconTag,
} from '@tabler/icons-react'
import LibraryPage from './pages/LibraryPage'
import TracePage from './pages/TracePage'
import SettingsPage from './pages/SettingsPage'

export type Route = { page: 'library' } | { page: 'trace'; id: number } | { page: 'settings' }

function Soon() {
  return (
    <Badge size="xs" variant="light" color="gray">
      v0.2
    </Badge>
  )
}

export default function App() {
  const [route, setRoute] = useState<Route>({ page: 'library' })
  const go = (r: Route) => setRoute(r)
  const onLibrary = route.page === 'library' || route.page === 'trace'

  return (
    <AppShell navbar={{ width: 240, breakpoint: 'sm' }} padding="lg">
      <AppShell.Navbar p="sm">
        <Group gap="sm" px="xs" pb="md" pt="xs">
          <ThemeIcon size={32} radius="md">
            <IconRoute size={18} />
          </ThemeIcon>
          <Text fw={700} size="lg">
            Organisons
          </Text>
        </Group>
        <Stack gap={2} style={{ flex: 1 }}>
          <NavLink label="Bibliothèque" leftSection={<IconStack2 size={18} />} active={onLibrary} onClick={() => go({ page: 'library' })} />
          <NavLink label="Collections" leftSection={<IconFolder size={18} />} rightSection={<Soon />} disabled />
          <NavLink label="Tags" leftSection={<IconTag size={18} />} rightSection={<Soon />} disabled />
          <NavLink label="Doublons" leftSection={<IconCopy size={18} />} rightSection={<Soon />} disabled />
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" px="sm" pt="md" pb={4}>
            Sources
          </Text>
          <NavLink label="Komoot" leftSection={<IconRefresh size={18} />} rightSection={<Soon />} disabled />
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" px="sm" pt="md" pb={4}>
            Connexions
          </Text>
          <NavLink label="Agenda Pédalons" leftSection={<IconCalendar size={18} />} rightSection={<Soon />} disabled />
          <NavLink label="Appareils GPS" leftSection={<IconDeviceWatch size={18} />} rightSection={<Soon />} disabled />
          <NavLink
            mt="auto"
            label="Réglages"
            leftSection={<IconSettings size={18} />}
            active={route.page === 'settings'}
            onClick={() => go({ page: 'settings' })}
          />
          <Group gap={6} px="sm" pt={4}>
            <IconBuildingBroadcastTower size={12} color="#868e96" />
            <Text size="xs" c="dimmed">
              v0.1
            </Text>
          </Group>
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        {route.page === 'library' && <LibraryPage onOpen={(id) => go({ page: 'trace', id })} onSettings={() => go({ page: 'settings' })} />}
        {route.page === 'trace' && <TracePage id={route.id} onBack={() => go({ page: 'library' })} />}
        {route.page === 'settings' && <SettingsPage />}
      </AppShell.Main>
    </AppShell>
  )
}
