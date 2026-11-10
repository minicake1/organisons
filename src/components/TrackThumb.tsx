import { useEffect, useRef, useState } from 'react'
import { requestThumb, THUMB_H, THUMB_W } from './thumbRenderer'

/**
 * Vignette d'une trace. Affiche d'abord un dessin simple (SVG), remplacé par
 * une image avec fond de carte dès que la vignette est visible et rendue.
 * Hors ligne, le dessin simple reste.
 */
export default function TrackThumb({ id, preview, height = 160 }: { id?: number; preview: [number, number][]; height?: number }) {
  const box = useRef<HTMLDivElement | null>(null)
  const key = id != null && preview.length > 1 ? `${id}:${preview.length}:${preview[0].join(',')}:${preview[preview.length - 1].join(',')}` : null
  const [img, setImg] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  // Largeur affichée, arrondie à 20 px (réutilise le cache, évite de redessiner pour 1 px).
  const [width, setWidth] = useState(0)

  // Visible une fois → on garde l'image ; taille suivie en continu (fenêtre ↔ plein écran).
  useEffect(() => {
    const el = box.current
    if (!key || !el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      // On attend la fin du redimensionnement avant de redessiner.
      clearTimeout(timer)
      timer = setTimeout(() => setWidth(Math.round((el.clientWidth || THUMB_W) / 20) * 20), 250)
    })
    ro.observe(el)
    setWidth(Math.round((el.clientWidth || THUMB_W) / 20) * 20)
    return () => {
      io.disconnect()
      ro.disconnect()
      clearTimeout(timer)
    }
  }, [key])

  useEffect(() => {
    if (!key || !visible || width <= 0) return
    let alive = true
    // L'image précédente reste affichée (étirée) pendant le nouveau rendu.
    const r = requestThumb(key, preview, width, height)
    if (r.cached) setImg(r.cached)
    r.promise?.then((url) => alive && setImg(url)).catch(() => {})
    return () => {
      alive = false
      r.cancel()
    }
  }, [key, visible, width, height]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={box} style={{ position: 'relative', height, background: '#eef1ea', overflow: 'hidden' }}>
      {img ? (
        <img src={img} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <SvgTrack preview={preview} height={height} />
      )}
    </div>
  )
}

/** Dessin simple de la trace (en attendant l'image, ou hors ligne). */
function SvgTrack({ preview, height }: { preview: [number, number][]; height: number }) {
  const W = THUMB_W
  const H = THUMB_H
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
    <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height }}>
      <path d={d} fill="none" stroke="#ffffff" strokeWidth={6} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#e03131" strokeWidth={3} strokeLinejoin="round" />
    </svg>
  )
}
