// Préférences gardées par l'interface (localStorage) qui font partie de la
// sauvegarde de la configuration : thème, FTP, dossier Zwift.

const KEYS = ['mantine-color-scheme-value', 'organisons.ftp', 'organisons.zwiftFolder']

export function readUiPrefs(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of KEYS) {
    try {
      const v = localStorage.getItem(k)
      if (v != null) out[k] = v
    } catch {
      // mémoire indisponible : on sauvegarde ce qu'on peut
    }
  }
  return out
}

export function writeUiPrefs(ui: Record<string, string>) {
  for (const [k, v] of Object.entries(ui)) {
    if (!KEYS.includes(k)) continue
    try {
      localStorage.setItem(k, v)
    } catch {
      // ignoré
    }
  }
}
