import { useCallback, useEffect, useState } from 'react'
import { AppShell, Badge, Group, NavLink, Stack, Text, ThemeIcon } from '@mantine/core'
import {


  IconBuildingBroadcastTower,
  IconBarbell,
  IconCalendar,
  IconCopy,
  IconDeviceWatch,
  IconFolder,
  IconLink,
  IconRefresh,
  IconRoute,
  IconSettings,
  IconTrash,
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
import TrashPage from './pages/TrashPage'
import TourPage from './pages/TourPage'
import KomootPage from './pages/KomootPage'
import OpenrunnerPage from './pages/OpenrunnerPage'
import WorkoutsPage from './pages/WorkoutsPage'

export type Route =
  | { page: 'library'; filter?: TraceFilter }
  | { page: 'trace'; id: number; back: Route }
  | { page: 'settings' }
  | { page: 'tags' }
  | { page: 'collections' }
  | { page: 'duplicates' }
  | { page: 'trash' }
  | { page: 'collection'; id: number }
  | { page: 'tour'; id: number }
  | { page: 'komoot' }
  | { page: 'openrunner' }
  | { page: 'workouts' }

/** Fonctions prévues mais pas encore disponibles. */
function Soon() {
  return (
    <Badge size="xs" variant="light" color="gray">
      bientôt
    </Badge>
  )
}

export default function App() {
  // Historique des écrans visités (précédent / suivant), 50 au plus.
  const [nav, setNav] = useState<{ stack: Route[]; i: number }>({ stack: [{ page: 'library' }], i: 0 })
  const route = nav.stack[nav.i]
  const push = (make: (current: Route) => Route) =>
    setNav((n) => {
      const stack = [...n.stack.slice(0, n.i + 1), make(n.stack[n.i])].slice(-50)
      return { stack, i: stack.length - 1 }
    })
  const go = (r: Route) => push(() => r)
  const open = (id: number) => push((current) => ({ page: 'trace', id, back: current }))
  const back = useCallback(() => setNav((n) => (n.i > 0 ? { ...n, i: n.i - 1 } : n)), [])
  const forward = useCallback(() => setNav((n) => (n.i < n.stack.length - 1 ? { ...n, i: n.i + 1 } : n)), [])



  // Alt+← / Alt+→ et boutons latéraux de la souris, comme dans un navigateur (pas de flèches à l’écran).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        forward()
      }
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        back()
      } else if (e.button === 4) {
        e.preventDefault()
        forward()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [back, forward])
  const [dupCount, setDupCount] = useState(0)
  const [trashCount, setTrashCount] = useState(0)
  const onLibrary = route.page === 'library' || (route.page === 'trace' && route.back.page === 'library')
  const from = route.page === 'trace' ? route.back.page : route.page

  const countDuplicates = useCallback(() => {
    api
      .duplicateSets()
      .then((s) => setDupCount(s.reduce((n, g) => n + g.traces.length - 1, 0)))
      .catch(() => {})
  }, [])
  useEffect(countDuplicates, [countDuplicates, route.page])
  const countTrash = useCallback(() => {
    api
      .trashInfo()
      .then((i) => setTrashCount(i.count))
      .catch(() => {})
  }, [])
  useEffect(countTrash, [countTrash, route.page])
  useEffect(() => {
    window.addEventListener("organisons:corbeille", countTrash)
    return () => window.removeEventListener("organisons:corbeille", countTrash)
  }, [countTrash])

  return (
    <AppShell navbar={{ width: 240, breakpoint: 'sm' }} padding="lg">
      <AppShell.Navbar p="sm">
        <Group gap="sm" px="xs" pb="md" pt="xs" wrap="nowrap">
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
            label="Entraînements"
            leftSection={<IconBarbell size={18} />}
            active={route.page === 'workouts'}
            onClick={() => go({ page: 'workouts' })}
          />
          <NavLink
            label="Collections"
            leftSection={<IconFolder size={18} />}
            active={from === 'collections' || from === 'collection' || from === 'tour'}
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
          <NavLink label="Komoot" leftSection={<IconRefresh size={18} />} active={route.page === 'komoot'} onClick={() => go({ page: 'komoot' })} />
          <NavLink
            label="Openrunner"
            leftSection={<IconLink size={18} />}
            active={route.page === 'openrunner'}
            onClick={() => go({ page: 'openrunner' })}
          />
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" px="sm" pt="md" pb={4}>
            Connexions
          </Text>
          <NavLink label="Agenda Pédalons" leftSection={<IconCalendar size={18} />} rightSection={<Soon />} disabled />
          <NavLink label="Appareils GPS" leftSection={<IconDeviceWatch size={18} />} rightSection={<Soon />} disabled />
          <NavLink
            mt="auto"
            label="Corbeille"
            leftSection={<IconTrash size={18} />}
            active={from === 'trash'}
            onClick={() => go({ page: 'trash' })}
            rightSection={
              trashCount > 0 ? (
                <Badge size="sm" color="gray" variant="light">
                  {trashCount}
                </Badge>
              ) : undefined
            }
          />
          <NavLink
            label="Réglages"
            leftSection={<IconSettings size={18} />}
            active={route.page === 'settings'}
            onClick={() => go({ page: 'settings' })}
          />
          <Group gap={6} px="sm" pt={4}>
            <IconBuildingBroadcastTower size={12} color="#868e96" />
            <Text size="xs" c="dimmed">
              v0.4{import.meta.env.DEV ? " (dev)" : ""}
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
        {route.page === 'komoot' && <KomootPage onLibrary={() => go({ page: 'library' })} />}
        {route.page === 'openrunner' && <OpenrunnerPage onLibrary={() => go({ page: 'library' })} />}
        {route.page === 'workouts' && <WorkoutsPage />}
        {route.page === 'trash' && (
          // Trace restaurée : elle est de retour dans la Bibliothèque, on l’ouvre depuis là.
          <TrashPage onOpen={(id) => go({ page: 'trace', id, back: { page: 'library' } })} onChanged={countTrash} />
        )}
        {route.page === 'tags' && <TagsPage onOpenTag={(tag) => go({ page: 'library', filter: { tag } })} />}
        {route.page === 'collections' && <CollectionsPage onOpenCollection={(c) => go(c.isTour ? { page: 'tour', id: c.id } : { page: 'collection', id: c.id })} />}
        {route.page === 'tour' && <TourPage key={route.id} id={route.id} onBack={() => go({ page: 'collections' })} onOpen={open} />}
        {route.page === 'collection' && (
          <LibraryPage
            key={`collection-${route.id}`}
            initialFilter={{ collection: route.id }}
            onOpen={open}
            onSettings={() => go({ page: 'settings' })}
            onBack={() => go({ page: 'collections' })}
          />
        )}
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
    case 'tour':
      return 'Tour'
    case 'collection':
      return 'Collection'
    case 'collections':
      return 'Collections'
    default:
      return 'Bibliothèque'
  }
}
