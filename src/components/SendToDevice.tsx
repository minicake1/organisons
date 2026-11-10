import { useEffect, useState } from 'react'
import { Button, Menu, Text, Tooltip } from '@mantine/core'
import { IconChevronDown, IconDeviceWatch } from '@tabler/icons-react'
import { api } from '../api'
import { date } from '../labels'

/**
 * Bouton « Envoyer vers l'appareil » de la fiche : vers le compte Hammerhead
 * (le Karoo récupère le parcours à sa synchronisation). Une trace déjà envoyée
 * est mise à jour ; on peut aussi la retirer.
 */
export default function SendToDevice({ traceId, onMessage }: { traceId: number; onMessage: (text: string, error?: boolean) => void }) {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [sentAt, setSentAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .hammerheadStatus()
      .then((s) => setConnected(s.connected))
      .catch(() => setConnected(false))
    api
      .hammerheadSentAt(traceId)
      .then(setSentAt)
      .catch(() => {})
  }, [traceId])

  if (!connected) {
    return (
      <Tooltip label="Connecte ton compte Hammerhead dans Réglages → Appareils (Garmin et Wahoo : plus tard)">
        <Button variant="default" leftSection={<IconDeviceWatch size={16} />} data-disabled onClick={(e) => e.preventDefault()}>
          Envoyer vers l'appareil
        </Button>
      </Tooltip>
    )
  }

  const send = async () => {
    setBusy(true)
    try {
      const r = await api.hammerheadSend([traceId])
      if (r.errors.length) onMessage(r.errors[0], true)
      else onMessage(r.updated ? 'Parcours mis à jour sur Hammerhead : le Karoo le récupère à sa prochaine synchronisation.' : 'Parcours envoyé vers Hammerhead : le Karoo le récupère à sa prochaine synchronisation.')
      setSentAt(await api.hammerheadSentAt(traceId))
    } catch (e) {
      onMessage(String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.hammerheadRemove(traceId)
      setSentAt(null)
      onMessage('Parcours retiré de ton compte Hammerhead.')
    } catch (e) {
      onMessage(String(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button variant="default" leftSection={<IconDeviceWatch size={16} />} rightSection={<IconChevronDown size={14} />} loading={busy}>
          {sentAt ? 'Sur le Karoo' : "Envoyer vers l'appareil"}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {sentAt && (
          <Menu.Label>
            <Text size="xs">Envoyé le {date(sentAt)}</Text>
          </Menu.Label>
        )}
        <Menu.Item onClick={send}>{sentAt ? 'Mettre à jour sur le Karoo' : 'Envoyer vers le Karoo (Hammerhead)'}</Menu.Item>
        {sentAt && (
          <Menu.Item color="red" onClick={remove}>
            Retirer du Karoo
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}
