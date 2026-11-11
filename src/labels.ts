// Libellés, couleurs et formats partagés par les écrans.
import type { Hilliness, PoiKind, SurfaceClass, Wind } from './api'

export const HILLINESS: Record<Hilliness, string> = {
  FLAT: 'Plat',
  HILLY: 'Vallonné',
  MOUNTAINOUS: 'Montagneux',
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
  { kind: 'lodging', label: 'Hébergement', color: '#c2255c', big: false, byDefault: false },
  { kind: 'service', label: 'Services', color: '#1098ad', big: false, byDefault: false },
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

/** Revêtement calculé depuis OpenStreetMap : libellés et couleurs du profil et de la carte. */
export const SURFACE_CLASSES: { value: SurfaceClass; label: string; color: string }[] = [
  { value: 'paved', label: 'Asphalte', color: '#5c7cfa' },
  { value: 'cobbles', label: 'Pavés', color: '#ae3ec9' },
  { value: 'gravel', label: 'Stabilisé, gravier', color: '#f59f00' },
  { value: 'unpaved', label: 'Chemin, terre', color: '#8d5524' },
  { value: 'unknown', label: 'Inconnu', color: '#ced4da' },
]
export const surfaceColor = (c: SurfaceClass) => SURFACE_CLASSES.find((s) => s.value === c)?.color ?? '#ced4da'

/** Couleur de chaque sport (badges des tuiles, de la liste et de la fiche). */
export const SPORT_COLORS: Record<string, { bg: string; fg: string }> = {
  Route: { bg: '#1c7ed6', fg: '#fff' },
  Gravel: { bg: '#2b8a3e', fg: '#fff' },
  VTT: { bg: '#8d5524', fg: '#fff' },
  Vélo: { bg: '#7048e8', fg: '#fff' },
  Randonnée: { bg: '#fcc419', fg: '#212529' },
  'Course à pied': { bg: '#e8590c', fg: '#fff' },
}
export const sportColor = (sport: string) => SPORT_COLORS[sport] ?? { bg: '#868e96', fg: '#fff' }
