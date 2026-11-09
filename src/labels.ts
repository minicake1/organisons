// Libellés, couleurs et formats partagés par les écrans.
import type { Hilliness, PoiKind, Wind } from './api'

export const HILLINESS: Record<Hilliness, string> = {
  FLAT: 'Plat',
  HILLY: 'Vallonné',
  MOUNTAINOUS: 'Montagneux',
}

export const SURFACES: Record<string, string> = {
  ROAD: 'Route',
  GRAVEL: 'Gravel',
  MTB: 'VTT',
  MIXED: 'Mixte',
}

export const WINDS: { value: Wind; label: string; angle: number }[] = [
  { value: 'N', label: 'Nord', angle: 0 },
  { value: 'NE', label: 'Nord-Est', angle: 45 },
  { value: 'E', label: 'Est', angle: 90 },
  { value: 'SE', label: 'Sud-Est', angle: 135 },
  { value: 'S', label: 'Sud', angle: 180 },
  { value: 'SW', label: 'Sud-Ouest', angle: 225 },
  { value: 'W', label: 'Ouest', angle: 270 },
  { value: 'NW', label: 'Nord-Ouest', angle: 315 },
]
export const windLabel = (w: Wind) => WINDS.find((x) => x.value === w)?.label ?? w
/** Abréviation française : O pour Ouest (W en interne). */
export const windShort = (w: Wind) => w.replace('W', 'O')
/** Rotation d'une flèche « vers le haut » pour montrer où souffle le vent. */
export const windArrowDeg = (w: Wind) => ((WINDS.find((x) => x.value === w)?.angle ?? 0) + 180) % 360

export const POI_KINDS: { kind: PoiKind; label: string; color: string; big: boolean; byDefault: boolean }[] = [
  { kind: 'control', label: 'Contrôles', color: '#212529', big: true, byDefault: true },
  { kind: 'warning', label: 'Attention', color: '#d9480f', big: true, byDefault: true },
  { kind: 'water', label: 'Eau', color: '#1c7ed6', big: false, byDefault: false },
  { kind: 'shop', label: 'Commerces', color: '#7048e8', big: false, byDefault: false },
  { kind: 'sight', label: 'Curiosités', color: '#2b8a3e', big: false, byDefault: false },
  { kind: 'other', label: 'Autres', color: '#868e96', big: false, byDefault: false },
]
export const poiKind = (k: PoiKind) => POI_KINDS.find((p) => p.kind === k) ?? POI_KINDS[POI_KINDS.length - 1]

export function slopeColor(s: number): string {
  const a = Math.abs(s)
  return a < 3 ? '#c0eb75' : a < 6 ? '#ffd43b' : a < 9 ? '#ff922b' : '#f03e3e'
}

const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
export const km1 = (n: number) => nf1.format(n)
export const int = (n: number) => nf0.format(n)
export const date = (unix: number) => new Date(unix * 1000).toLocaleDateString('fr-FR')

/** Plus petit pas « rond » de la liste supérieur ou égal à la cible. */
export function niceStep(target: number, steps: number[]): number {
  return steps.find((s) => s >= target) ?? steps[steps.length - 1]
}
