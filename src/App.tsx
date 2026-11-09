import { useCallback, useEffect, useState } from 'react'
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
import { api, type TraceFilter } from './api'
import LibraryPage from './pages/LibraryPage'
import TracePage from './pages/TracePage'
import SettingsPage from './pages/SettingsPage'
import TagsPage from './pages/TagsPage'
import CollectionsPage from './pages/CollectionsPage'
import DuplicatesPage from './pages/DuplicatesPage'

export type Route =
  | { page: 'library'; filter?: TraceFilter }
  | { page: 'trace'; id: number; back: Route }
  | { page: 'settings' }
  | { page: 'tags' }
  | { page: 'collections' }
  | { page: 'duplicates' }

/** Fonctions prévues mais pas encore disponibles. */
function Soon() {
  return (
    <Badge size="xs" variant="light" color="gray">
      bientôt
    </Badge>
  )
}

export default function App() {
  const [route, setRoute] = useState<Route>({ page: 'library' })
  const [dupCount, setDupCount] = useState(0)
  const go = (r: Route) => setRoute(r)
  const open = (id: number) => setRoute((r) => ({ page: 'trace', id, back: r }))
  const onLibrary = route.page === 'library' || (route.page === 'trace' && route.back.page === 'library')
  const from = route.page === 'trace' ? route.back.page : route.page

  const countDuplicates = useCallback(() => {
    api
      .duplicateSets()
      .then((s) => setDupCount(s.reduce((n, g) => n + g.traces.length - 1, 0)))
      .catch(() => {})
  }, [])
  useEffect(countDuplicates, [countDuplicates, route.page])

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
          <NavLink
            label="Collections"
            leftSection={<IconFolder size={18} />}
            active={from === 'collections'}
            onClick={() => go({ page: 'collections' })}
          />
          <NavLink label="Tags" leftSection={<IconTag size={18} />} active={from === 'tags'} onClick={() => go({ page: 'tags' })} />
          <NavLink
            label="Doublons"
            leftSection={<IconCopy size={18} />}
            active={from === 'duplicates'}
            onClick={() => go({ page: 'duplicates' })}
            rightSection={
              dupCount > 0 ? (
                <Badge size="sm" color="orange" variant="light">
                  {dupCount}
                </Badge>
              ) : undefined
            }
          />
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
              v0.2
            </Text>
          </Group>
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        {route.page === 'library' && (
          <LibraryPage key={JSON.stringify(route.filter ?? {})} initialFilter={route.filter} onOpen={open} onSettings={() => go({ page: 'settings' })} />
        )}
        {route.page === 'trace' && <TracePage id={route.id} onBack={() => go(route.back)} backLabel={backLabel(route.back)} />}
        {route.page === 'settings' && <SettingsPage />}
        {route.page === 'tags' && <TagsPage onOpenTag={(tag) => go({ page: 'library', filter: { tag } })} />}
        {route.page === 'collections' && <CollectionsPage onOpenCollection={(collection) => go({ page: 'library', filter: { collection } })} />}
        {route.page === 'duplicates' && <DuplicatesPage onOpen={open} onChanged={countDuplicates} />}
      </AppShell.Main>
    </AppShell>
  )
}

function backLabel(r: Route): string {
  switch (r.page) {
    case 'duplicates':
      return 'Doublons'
    case 'tags':
      return 'Tags'
    case 'collections':
      return 'Collections'
    default:
      return 'Bibliothèque'
  }
}
