// Envoi par lot vers le compte Hammerhead, avec l'avancement envoyé par le cœur.
import { listen } from '@tauri-apps/api/event'
import { api, type SendReport } from './api'

/** Envoie les traces ; `onProgress` reçoit (fait, total). Renvoie un message lisible. */
export async function sendToKaroo(ids: number[], onProgress: (done: number, total: number) => void): Promise<{ text: string; report: SendReport }> {
  const off = await listen<{ done: number; total: number }>('hammerhead-progress', (e) => onProgress(e.payload.done, e.payload.total))
  try {
    const report = await api.hammerheadSend(ids)
    const parts = []
    if (report.sent) parts.push(`${report.sent} envoyé(s)`)
    if (report.updated) parts.push(`${report.updated} mis à jour`)
    if (report.errors.length) parts.push(`${report.errors.length} en erreur`)
    return { text: `Karoo : ${parts.join(', ') || 'rien à envoyer'}. Le Karoo les récupère à sa prochaine synchronisation.`, report }
  } finally {
    off()
  }
}
