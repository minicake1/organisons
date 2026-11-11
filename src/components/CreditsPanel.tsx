import { Anchor, Paper, Stack, Text } from '@mantine/core'
import { APP_VERSION } from '../version'

const link = (href: string, label: string) => (
  <Anchor size="sm" href={href} target="_blank">
    {label}
  </Anchor>
)

/** Réglages → À propos : licence, données, services et logiciels utilisés. */
export default function CreditsPanel() {
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text size="sm">
          Organisons {APP_VERSION}, sous licence {link('https://www.gnu.org/licenses/agpl-3.0.html', 'GNU AGPL v3 ou ultérieure')}. Code source :{' '}
          {link('https://github.com/minicake1/organisons', 'github.com/minicake1/organisons')}.
        </Text>
        <div>
          <Text size="sm" fw={600}>
            Données cartographiques
          </Text>
          <Text size="sm" c="dimmed">
            © {link('https://www.openstreetmap.org/copyright', 'contributeurs OpenStreetMap')} (ODbL) ; fonds de carte{' '}
            {link('https://openfreemap.org', 'OpenFreeMap')} (© OpenMapTiles) ; tuiles du revêtement {link('https://versatiles.org', 'VersaTiles')}.
          </Text>
        </div>
        <div>
          <Text size="sm" fw={600}>
            Services reliés
          </Text>
          <Text size="sm" c="dimmed">
            {link('https://gpx.studio', 'gpx.studio')} (éditeur open source, licence MIT), Pédalons, Komoot, Openrunner, Hammerhead, Zwift, intervals.icu
            et MyWhoosh. Ces noms et marques appartiennent à leurs propriétaires ; Organisons n’est affilié à aucun d’eux. Komoot est utilisé
            par son API interne, non officielle.
          </Text>
        </div>
        <div>
          <Text size="sm" fw={600}>
            Logiciels libres utilisés
          </Text>
          <Text size="sm" c="dimmed">
            {link('https://tauri.app', 'Tauri')}, Rust, {link('https://react.dev', 'React')}, {link('https://mantine.dev', 'Mantine')},{' '}
            {link('https://maplibre.org', 'MapLibre GL JS')}, {link('https://tabler.io/icons', 'Tabler Icons')}, SQLite (rusqlite), gpx,
            roxmltree, ureq, keyring, @mapbox/vector-tile et pbf, ainsi que leurs dépendances, chacun sous sa propre licence.
          </Text>
        </div>
      </Stack>
    </Paper>
  )
}
