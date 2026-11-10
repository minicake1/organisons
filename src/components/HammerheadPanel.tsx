import { useEffect, useState } from 'react'
import { Anchor, Badge, Button, Code, Group, Paper, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { api, type HammerheadStatus } from '../api'

/**
 * Réglages → Hammerhead (Karoo) : l'application créée par l'utilisateur sur le
 * Dashboard Hammerhead, puis la connexion de son compte par le navigateur.
 */
export default function HammerheadPanel() {
  const [status, setStatus] = useState<HammerheadStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [redirect, setRedirect] = useState('http://localhost:3001')
  const [busy, setBusy] = useState<'save' | 'connect' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)

  const refresh = () =>
    api
      .hammerheadStatus()
      .then((s) => {
        setStatus(s)
        setClientId(s.clientId)
        setRedirect(s.redirectUri)
      })
      .catch((e) => setError(String(e)))
  useEffect(() => {
    refresh()
  }, [])

  const save = async () => {
    setBusy('save')
    setError(null)
    setNotice(null)
    try {
      await api.hammerheadSetClient(clientId, secret, redirect)
      setSecret('')
      setNotice('Application Hammerhead enregistrée.')
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  const connect = async () => {
    setBusy('connect')
    setError(null)
    setNotice('Page Hammerhead ouverte dans ton navigateur : accepte l’accès, puis reviens ici.')
    try {
      await api.hammerheadConnect()
      setNotice('Compte Hammerhead connecté : « Envoyer vers l’appareil » est disponible sur les fiches.')
      await refresh()
    } catch (e) {
      setNotice(null)
      // Une connexion annulée ou remplacée n’est pas une erreur à afficher.
      if (String(e).includes("remplacée")) return
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group>
          <Text fw={600}>Hammerhead (Karoo)</Text>
          {status?.connected ? (
            <Badge color="green" variant="light">
              Compte connecté
            </Badge>
          ) : status?.configured ? (
            <Badge color="yellow" variant="light">
              À connecter
            </Badge>
          ) : (
            <Badge color="gray" variant="light">
              Pas configuré
            </Badge>
          )}
        </Group>
        {status?.builtin && !advanced ? (
          <Text size="sm" c="dimmed">
            Comme avec Pédalons : clique sur « Connecter mon compte », connecte-toi sur la page Hammerhead et accepte l’accès. Rien d’autre à
            saisir : l’application Organisons est intégrée.{" "}
            <Anchor size="sm" component="button" type="button" onClick={() => setAdvanced(true)}>
              Utiliser une autre application…
            </Anchor>
          </Text>
        ) : (
          <>
            <Text size="xs" c="dimmed">
              Application Hammerhead à utiliser (Dashboard Hammerhead, compte développeur, onglet « Réglages de l’API ») : même adresse de
              retour qu’ici. Client ID et secret sont rangés dans le gestionnaire d’identifiants de Windows.
            </Text>
            <Group grow align="flex-start">
              <TextInput
                label="Client ID"
                placeholder="1a2b3c4d-5e6f-…"
                autoComplete="off"
                name="hammerhead-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.currentTarget.value)}
              />
              <PasswordInput
                label="Secret client"
                autoComplete="new-password"
                name="hammerhead-client-secret"
                placeholder={status?.configured && !status.builtin ? "Enregistré (laisser vide pour le garder)" : ""}
                value={secret}
                onChange={(e) => setSecret(e.currentTarget.value)}
              />
              <TextInput
                label="Adresse de retour"
                description="Identique à celle du Dashboard"
                value={redirect}
                onChange={(e) => setRedirect(e.currentTarget.value)}
              />
            </Group>
            <Group>
              <Button variant="default" onClick={save} loading={busy === "save"} disabled={!clientId.trim() || (!secret && (!status?.configured || status.builtin))}>
                Enregistrer
              </Button>
              {status?.builtinAvailable && !status.builtin && (
                <Button
                  variant="subtle"
                  onClick={() =>
                    api
                      .hammerheadResetClient()
                      .then(() => {
                        setAdvanced(false)
                        return refresh()
                      })
                      .catch((e) => setError(String(e)))
                  }
                >
                  Revenir à l’application Organisons intégrée
                </Button>
              )}
            </Group>
          </>
        )}
        <Group>
          <Button onClick={connect} loading={busy === 'connect'} disabled={!status?.configured}>
            {status?.connected ? 'Reconnecter mon compte' : 'Connecter mon compte'}
          </Button>
          {busy === "connect" && (
            <Button variant="subtle" color="gray" onClick={() => api.hammerheadCancel().catch(() => {})}>
              Annuler la connexion
            </Button>
          )}
          {status?.connected && (
            <Button
              variant="subtle"
              color="gray"
              onClick={() =>
                api
                  .hammerheadDisconnect()
                  .then(refresh)
                  .catch((e) => setError(String(e)))
              }
            >
              Déconnecter
            </Button>
          )}
        </Group>
        {notice && (
          <Text size="sm" c="teal.8">
            {notice}
          </Text>
        )}
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          Les parcours envoyés arrivent dans ton compte Hammerhead ; le Karoo les récupère à sa prochaine synchronisation (Wi-Fi). Un parcours
          déjà envoyé est mis à jour, pas dupliqué. Adresse de retour par défaut : <Code>http://localhost:3001</Code>.
        </Text>
      </Stack>
    </Paper>
  )
}
