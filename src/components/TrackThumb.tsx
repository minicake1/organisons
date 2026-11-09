/** Vignette SVG d'une trace à partir de son aperçu [lat, lon]. */
export default function TrackThumb({ preview, height = 160 }: { preview: [number, number][]; height?: number }) {
  const W = 300
  const H = 180
  let d = ''
  if (preview.length > 1) {
    const lat0 = preview.reduce((s, p) => s + p[0], 0) / preview.length
    const k = Math.cos((lat0 * Math.PI) / 180)
    const xs = preview.map((p) => p[1] * k)
    const ys = preview.map((p) => -p[0])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const s = Math.min((W - 40) / (x1 - x0 || 1), (H - 40) / (y1 - y0 || 1))
    const ox = (W - s * (x1 - x0)) / 2
    const oy = (H - s * (y1 - y0)) / 2
    d = xs.map((x, i) => `${i ? 'L' : 'M'}${(ox + (x - x0) * s).toFixed(1)} ${(oy + (ys[i] - y0) * s).toFixed(1)}`).join('')
  }
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height, background: '#eef1ea' }}>
      <path d={d} fill="none" stroke="#ffffff" strokeWidth={6} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#e03131" strokeWidth={3} strokeLinejoin="round" />
    </svg>
  )
}
