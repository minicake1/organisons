import type { WorkoutBlock } from '../api'

/** Couleur d'une puissance (fraction de FTP), par zone. */
export function zoneColor(p: number): string {
  if (p < 0.6) return '#868e96' // Z1 récupération
  if (p < 0.76) return '#339af0' // Z2 endurance
  if (p < 0.9) return '#40c057' // Z3 tempo
  if (p < 1.05) return '#fab005' // Z4 seuil
  if (p < 1.18) return '#fd7e14' // Z5 VO2 max
  return '#fa5252' // Z6+ anaérobie
}

export const ZONES: [string, string][] = [
  ['#868e96', 'Z1 < 60 %'],
  ['#339af0', 'Z2 60–75 %'],
  ['#40c057', 'Z3 76–89 %'],
  ['#fab005', 'Z4 90–104 %'],
  ['#fd7e14', 'Z5 105–117 %'],
  ['#fa5252', 'Z6 ≥ 118 %'],
]

/**
 * Graphique d'une séance : un bloc par segment, hauteur = puissance (% FTP),
 * largeur = durée, couleur de la zone. Les rampes sont inclinées.
 */
export default function WorkoutChart({ blocks, height = 70, showFtp = false }: { blocks: WorkoutBlock[]; height?: number; showFtp?: boolean }) {
  const total = blocks.reduce((m, b) => Math.max(m, b.start + b.duration), 0) || 1
  const top = Math.max(1.3, ...blocks.map((b) => Math.max(b.from, b.to))) * 1.05
  const W = 1000
  const H = 100
  const x = (s: number) => (s / total) * W
  const y = (p: number) => H - (p / top) * H
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height }} aria-label="Profil de puissance de la séance">
      {showFtp && <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="#adb5bd" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />}
      {blocks.map((b, i) => {
        const x0 = x(b.start)
        const x1 = x(b.start + b.duration)
        const free = b.kind === 'free'
        return (
          <polygon
            key={i}
            points={`${x0},${H} ${x0},${y(b.from)} ${x1},${y(b.to)} ${x1},${H}`}
            fill={free ? '#dee2e6' : zoneColor((b.from + b.to) / 2)}
            stroke="#fff"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          >
            <title>
              {`${free ? 'Roue libre' : `${Math.round(b.from * 100)}${b.to !== b.from ? `→${Math.round(b.to * 100)}` : ''} % FTP`} · ${Math.round(b.duration / 60)} min${b.cadence ? ` · ${b.cadence} tr/min` : ''}`}
            </title>
          </polygon>
        )
      })}
    </svg>
  )
}
