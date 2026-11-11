import { useMemo, type CSSProperties } from 'react'
import { useElementSize } from '@mantine/hooks'
import type { Poi, ProfilePoint } from '../api'
import { int, km1, niceStep, poiKind, slopeColor } from '../labels'

// Marges en pixels : le profil est dessiné à sa taille réelle, sans
// étirement, quelle que soit la taille de l'écran.
const X0 = 50
const RIGHT = 12
const Y_TOP = 10
const BOTTOM = 30

interface Props {
  profile: ProfilePoint[]
  pois: Poi[]
  cursor: number | null
  onCursor: (index: number | null) => void
  /** Couleur de chaque tronçon (pente par défaut, ou revêtement). */
  colors?: string[]
  /** Hauteur du profil (px ou valeur CSS). */
  height?: number | string
  /** Partie affichée [km début, km fin] (suit le zoom de la carte) ; tout le profil sinon. */
  range?: [number, number] | null
  /** Mode « placer un point » : un clic donne l'indice du point du profil. */
  onPick?: (index: number) => void
}

/** Indice du point le plus proche d'un km (profil trié par km). */
export function indexAtKm(profile: ProfilePoint[], km: number): number {
  let lo = 0
  let hi = profile.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (profile[mid].km < km) lo = mid
    else hi = mid
  }
  return Math.abs(profile[lo].km - km) <= Math.abs(profile[hi].km - km) ? lo : hi
}

/**
 * Profil altimétrique : graduations adaptées à la longueur et au dénivelé,
 * couleur selon la pente la plus forte de chaque tronçon (ou le revêtement),
 * curseur partagé avec la carte, zoom calé sur la partie visible de la carte.
 */
export default function ElevationProfile({ profile, pois, cursor, onCursor, colors, height = 200, range, onPick }: Props) {
  const { ref, width, height: h } = useElementSize()
  const W = Math.max(200, width)
  const H = Math.max(100, h)
  const X1 = W - RIGHT
  const Y_BASE = H - BOTTOM
  const total = profile[profile.length - 1]?.km ?? 0
  const kmA = range ? Math.max(0, range[0]) : 0
  const kmB = range ? Math.min(total, range[1]) : total
  const zoomed = kmA > 0.001 || kmB < total - 0.001

  const g = useMemo(() => {
    const span = kmB - kmA || 1
    // Points de la partie affichée, plus un de chaque côté pour finir le tracé au bord.
    const i0 = Math.max(0, indexAtKm(profile, kmA) - 1)
    const i1 = Math.min(profile.length - 1, indexAtKm(profile, kmB) + 1)
    const eles = profile.slice(i0, i1 + 1).map((p) => p.ele)
    const mn = Math.min(...eles)
    const mx = Math.max(...eles)
    // Nombre de graduations selon la place disponible.
    const yCount = Math.max(2, Math.min(6, Math.floor((Y_BASE - Y_TOP) / 34)))
    const yStep = niceStep((mx - mn) / yCount || 10, [5, 10, 20, 25, 40, 50, 80, 100, 200, 250, 400, 500, 1000])
    // Un point à -1 m (bord de mer) ne doit pas faire descendre l'axe d'un pas entier.
    const ymin = mn > -yStep * 0.25 ? Math.max(0, Math.floor(mn / yStep) * yStep) : Math.floor(mn / yStep) * yStep
    let ymax = Math.ceil(mx / yStep) * yStep
    if (ymax - mx < yStep * 0.3) ymax += yStep
    const xCount = Math.max(3, Math.min(12, Math.floor((X1 - X0) / 70)))
    const xStep = niceStep(span / xCount, [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 30, 50, 60, 100, 120, 200])
    const px = (km: number) => X0 + ((km - kmA) / span) * (X1 - X0)
    const py = (e: number) => Y_BASE - ((e - ymin) / (ymax - ymin || 1)) * (Y_BASE - Y_TOP)

    // Bandes colorées regroupées par couleur consécutive.
    const bands: { d: string; color: string }[] = []
    let run: { color: string; pts: string[] } | null = null
    for (let i = i0; i < i1; i++) {
      const a = profile[i]
      const b = profile[i + 1]
      const color = colors?.[i] ?? slopeColor(a.slopeMax)
      const seg = `${px(a.km).toFixed(1)},${py(a.ele).toFixed(1)} ${(px(b.km) + 0.3).toFixed(1)},${py(b.ele).toFixed(1)}`
      if (run && run.color === color) run.pts.push(seg)
      else {
        if (run) bands.push(close(run))
        run = { color, pts: [seg] }
      }
    }
    if (run) bands.push(close(run))
    function close(r: { color: string; pts: string[] }) {
      const first = r.pts[0].split(' ')[0].split(',')[0]
      const last = r.pts[r.pts.length - 1].split(' ')[1].split(',')[0]
      return { color: r.color, d: `M${first},${Y_BASE} L${r.pts.join(' L')} L${last},${Y_BASE} Z` }
    }
    const line = profile
      .slice(i0, i1 + 1)
      .map((p, i) => `${i ? 'L' : 'M'}${px(p.km).toFixed(1)} ${py(p.ele).toFixed(1)}`)
      .join('')

    const yTicks: number[] = []
    for (let v = ymin; v <= ymax + 0.001; v += yStep) yTicks.push(v)
    const xTicks: number[] = []
    const room = Math.min(span * 0.5, 45 * (span / (X1 - X0))) // pas de graduation collée au km de fin
    for (let k = Math.ceil(kmA / xStep - 1e-9) * xStep; k <= kmB - room; k += xStep) xTicks.push(+k.toFixed(3))
    return { px, py, bands, line, yTicks, xTicks, xStep }
  }, [profile, colors, kmA, kmB, X1, Y_BASE])

  const label: CSSProperties = { position: 'absolute', fontSize: 11, color: 'var(--mantine-color-dimmed)', whiteSpace: 'nowrap', pointerEvents: 'none' }
  const kmText = (k: number) => (g.xStep < 1 ? km1(k) : int(k))
  const cur = cursor != null ? profile[cursor] : null
  const curIn = cur != null && cur.km >= kmA - 1e-6 && cur.km <= kmB + 1e-6
  const near = cur ? pois.find((p) => Math.abs(p.km - cur.km) <= (kmB - kmA) * 0.008) : undefined
  const curX = cur ? g.px(cur.km) : 0
  const shown = pois.filter((p) => p.km >= kmA && p.km <= kmB)

  const indexAt = (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    return indexAtKm(profile, kmA + f * (kmB - kmA))
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => onCursor(indexAt(e))

  return (
    <div ref={ref} style={{ position: 'relative', height, minHeight: 100, overflow: 'hidden' }}>
      {width > 0 && (
        <svg role="img" aria-label="Profil altimétrique" width={W} height={H} style={{ display: 'block', position: 'absolute', inset: 0 }}>
          <defs>
            <clipPath id="profil-zone">
              <rect x={X0} y={0} width={Math.max(0, X1 - X0)} height={Y_BASE + 1} />
            </clipPath>
          </defs>
          {g.yTicks.map((v) => (
            <line key={v} x1={X0} x2={X1} y1={g.py(v)} y2={g.py(v)} stroke="#dee2e6" strokeDasharray="2 3" />
          ))}
          {g.xTicks.map((k) => (
            <line key={k} x1={g.px(k)} x2={g.px(k)} y1={Y_BASE} y2={Y_BASE + 5} stroke="#868e96" />
          ))}
          <line x1={X0} x2={X0} y1={Y_TOP} y2={Y_BASE} stroke="#adb5bd" />
          <g clipPath="url(#profil-zone)">
            {g.bands.map((b, i) => (
              <path key={i} d={b.d} fill={b.color} />
            ))}
            <path d={g.line} fill="none" stroke="#495057" strokeWidth={1.2} strokeLinejoin="round" />
          </g>
          {cur && curIn && (
            <g>
              <line x1={curX} x2={curX} y1={Y_TOP} y2={Y_BASE + 6} style={{ stroke: "var(--mantine-color-text)" }} strokeDasharray="3 3" />
              <circle cx={curX} cy={g.py(cur.ele)} r={5} style={{ fill: "var(--mantine-color-text)", stroke: "var(--mantine-color-body)" }} strokeWidth={2} />
            </g>
          )}
        </svg>
      )}

      {width > 0 &&
        g.yTicks.map((v) => (
          <span key={v} style={{ ...label, right: W - X0 + 6, top: g.py(v), transform: 'translateY(-50%)' }}>
            {int(v)} m
          </span>
        ))}
      {width > 0 &&
        g.xTicks.map((k) => (
          <span key={k} style={{ ...label, left: g.px(k), top: Y_BASE + 10, transform: 'translateX(-50%)' }}>
            {k === 0 ? '0 km' : `${kmText(k)} km`}
          </span>
        ))}
      {width > 0 && (
        <span style={{ ...label, right: RIGHT, top: Y_BASE + 10, fontWeight: 600, color: 'var(--mantine-color-text)', background: 'var(--mantine-color-body)', paddingLeft: 4 }}>
          {zoomed ? `${km1(kmB)} km` : `${km1(total)} km`}
        </span>
      )}
      {width > 0 && zoomed && (
        <span style={{ ...label, left: X0 + 6, top: 2, fontSize: 10, background: 'color-mix(in srgb, var(--mantine-color-body) 85%, transparent)', padding: '1px 5px', borderRadius: 4 }}>
          Partie visible sur la carte : km {km1(kmA)} – {km1(kmB)}
        </span>
      )}

      {width > 0 &&
        shown.map((p, i) => {
          const k = poiKind(p.kind)
          const size = k.big ? 12 : 8
          return (
            <span
              key={i}
              title={p.name}
              style={{
                position: 'absolute',
                left: g.px(p.km),
                top: Y_BASE, // posés sur l’axe des km
                width: size,
                height: size,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background: k.color,
                border: `${k.big ? 2 : 1}px solid #fff`,
                pointerEvents: 'none',
              }}
            />
          )
        })}

      <div
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => onCursor(null)}
        onClick={onPick ? (e) => onPick(indexAt(e)) : undefined}
        style={{ position: 'absolute', left: X0, width: Math.max(0, X1 - X0), top: 0, height: Y_BASE, cursor: 'crosshair', touchAction: 'pan-y' }}
      />

      {cur && curIn && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            [curX > W * 0.55 ? 'right' : 'left']: curX > W * 0.55 ? W - curX + 12 : curX + 12,
            background: 'var(--mantine-color-body)',
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,.12)',
            padding: '8px 12px',
            pointerEvents: 'none',
            fontSize: 12,
            zIndex: 3,
          }}
        >
          {near && (
            <div style={{ fontWeight: 700, color: '#fff', background: '#212529', borderRadius: 4, padding: '2px 6px', marginBottom: 6, display: 'inline-block' }}>{near.name}</div>
          )}
          <div style={{ display: 'flex', gap: 12, whiteSpace: 'nowrap', color: 'var(--mantine-color-text)' }}>
            <span>
              <b>{km1(cur.km)}</b> km
            </span>
            <span>
              Pente <b>{(cur.slope < 0 ? '−' : '') + km1(Math.abs(cur.slope))} %</b>
            </span>
            <span>
              Alt. <b>{int(cur.ele)} m</b>
            </span>
            <span>
              ↑ <b>{int(cur.up)} m</b>
            </span>
            <span>
              ↓ <b>{int(cur.down)} m</b>
            </span>
            {cur.minutes != null && (
              <span>
                Passage <b>+{Math.floor(cur.minutes / 60)} h {String(Math.round(cur.minutes % 60)).padStart(2, '0')}</b>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
