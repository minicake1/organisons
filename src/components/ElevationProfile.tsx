import { useMemo, type CSSProperties } from 'react'
import type { Poi, ProfilePoint } from '../api'
import { int, km1, niceStep, poiKind, slopeColor } from '../labels'

const W = 800
const H = 210
const X0 = 56
const X1 = 790
const Y_TOP = 10
const Y_BASE = 170

interface Props {
  profile: ProfilePoint[]
  pois: Poi[]
  cursor: number | null
  onCursor: (index: number | null) => void
}

/**
 * Profil altimétrique : graduations adaptées à la longueur et au dénivelé,
 * couleur selon la pente la plus forte de chaque tronçon, curseur partagé
 * avec la carte.
 */
export default function ElevationProfile({ profile, pois, cursor, onCursor }: Props) {
  const total = profile[profile.length - 1]?.km ?? 0
  const g = useMemo(() => {
    const eles = profile.map((p) => p.ele)
    const mn = Math.min(...eles)
    const mx = Math.max(...eles)
    const yStep = niceStep((mx - mn) / 6 || 10, [5, 10, 20, 25, 40, 50, 80, 100, 200, 250, 400, 500, 1000])
    // Un point à -1 m (bord de mer) ne doit pas faire descendre l'axe d'un pas entier.
    const ymin = mn > -yStep * 0.25 ? Math.max(0, Math.floor(mn / yStep) * yStep) : Math.floor(mn / yStep) * yStep
    let ymax = Math.ceil(mx / yStep) * yStep
    if (ymax - mx < yStep * 0.3) ymax += yStep
    const xStep = niceStep(total / 12, [1, 2, 5, 10, 20, 25, 30, 50, 60, 100, 120, 200])
    const px = (km: number) => X0 + (km / (total || 1)) * (X1 - X0)
    const py = (e: number) => Y_BASE - ((e - ymin) / (ymax - ymin || 1)) * (Y_BASE - Y_TOP)

    // Bandes colorées regroupées par couleur consécutive.
    const bands: { d: string; color: string }[] = []
    let run: { color: string; pts: string[] } | null = null
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i]
      const b = profile[i + 1]
      const color = slopeColor(a.slopeMax)
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
    const line = profile.map((p, i) => `${i ? 'L' : 'M'}${px(p.km).toFixed(1)} ${py(p.ele).toFixed(1)}`).join('')

    const yTicks: number[] = []
    for (let v = ymin; v <= ymax + 0.001; v += yStep) yTicks.push(v)
    const xTicks: number[] = []
    for (let k = 0; k <= total - xStep * 0.5; k += xStep) xTicks.push(k)
    return { px, py, bands, line, yTicks, xTicks }
  }, [profile, total])

  const label: CSSProperties = { position: 'absolute', fontSize: 11, color: '#5c636a', whiteSpace: 'nowrap', pointerEvents: 'none' }
  const cur = cursor != null ? profile[cursor] : null
  const near = cur ? pois.find((p) => Math.abs(p.km - cur.km) <= total * 0.008) : undefined
  const pct = cur ? (g.px(cur.km) / W) * 100 : 0

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    onCursor(Math.round(f * (profile.length - 1)))
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg role="img" aria-label="Profil altimétrique coloré selon la pente" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
        {g.yTicks.map((v) => (
          <line key={v} x1={X0} x2={X1} y1={g.py(v)} y2={g.py(v)} stroke="#dee2e6" strokeDasharray="2 3" />
        ))}
        {g.xTicks.map((k) => (
          <line key={k} x1={g.px(k)} x2={g.px(k)} y1={Y_BASE} y2={Y_BASE + 5} stroke="#868e96" />
        ))}
        <line x1={X0} x2={X0} y1={Y_TOP} y2={Y_BASE} stroke="#adb5bd" />
        {g.bands.map((b, i) => (
          <path key={i} d={b.d} fill={b.color} />
        ))}
        <path d={g.line} fill="none" stroke="#495057" strokeWidth={1.2} strokeLinejoin="round" />
        {cur && (
          <g>
            <line x1={g.px(cur.km)} x2={g.px(cur.km)} y1={Y_TOP} y2={Y_BASE + 6} stroke="#212529" strokeDasharray="3 3" />
            <circle cx={g.px(cur.km)} cy={g.py(cur.ele)} r={5} fill="#212529" stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>

      {g.yTicks.map((v) => (
        <span key={v} style={{ ...label, right: `${100 - 52 / 8}%`, top: `${(g.py(v) / H) * 100}%`, transform: 'translateY(-50%)' }}>
          {int(v)} m
        </span>
      ))}
      {g.xTicks.map((k) => (
        <span key={k} style={{ ...label, left: `${g.px(k) / 8}%`, top: '86%', transform: 'translateX(-50%)' }}>
          {k === 0 ? '0 km' : `${int(k)} km`}
        </span>
      ))}
      <span style={{ ...label, right: '1%', top: '86%', fontWeight: 600, color: '#343a40' }}>{km1(total)} km</span>

      {pois.map((p, i) => {
        const k = poiKind(p.kind)
        const size = k.big ? 16 : 7
        return (
          <span
            key={i}
            title={p.name}
            style={{
              position: 'absolute',
              left: `${g.px(p.km) / 8}%`,
              top: `${((k.big ? 155 : 164) / H) * 100}%`,
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
        style={{ position: 'absolute', left: `${(X0 / W) * 100}%`, width: `${((X1 - X0) / W) * 100}%`, top: 0, height: '84%', cursor: 'crosshair', touchAction: 'pan-y' }}
      />

      {cur && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            [pct > 55 ? 'right' : 'left']: `${pct > 55 ? 100 - pct + 1.5 : pct + 1.5}%`,
            background: '#fff',
            border: '1px solid #dee2e6',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,.12)',
            padding: '8px 12px',
            pointerEvents: 'none',
            fontSize: 12,
          }}
        >
          {near && (
            <div style={{ fontWeight: 700, color: '#fff', background: '#212529', borderRadius: 4, padding: '2px 6px', marginBottom: 6, display: 'inline-block' }}>{near.name}</div>
          )}
          <div style={{ display: 'flex', gap: 12, whiteSpace: 'nowrap', color: '#343a40' }}>
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
