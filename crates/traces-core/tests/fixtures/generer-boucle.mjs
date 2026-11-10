// Génère la trace de test synthétique `boucle-600.gpx` : une boucle d'environ
// 600 km au format d'un export Openrunner (piste horodatée, points d'intérêt
// avec les codes Openrunner), sans aucun lieu ni parcours réel.
//
//   node crates/traces-core/tests/fixtures/generer-boucle.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const N = 14322 // points de la piste
const CENTER = [49.2, -0.9] // lat, lon
const RX = 111.5 // demi-axes de l'ellipse, en km
const RY = 80
const KM_LAT = 111.32
const KM_LON = KM_LAT * Math.cos((CENTER[0] * Math.PI) / 180)
const START = Date.parse('2027-05-15T05:00:00Z')
const SPEED = 24 // km/h

const pts = []
let dist = 0
for (let i = 0; i < N; i++) {
  // Dernier point = premier : la boucle est fermée.
  const t = (i / (N - 1)) * 2 * Math.PI
  const x = RX * Math.cos(t)
  const y = RY * Math.sin(t)
  const lat = CENTER[0] + y / KM_LAT
  const lon = CENTER[1] + x / KM_LON
  if (i > 0) {
    const [plat, plon] = pts[i - 1]
    dist += Math.hypot((lat - plat) * KM_LAT, (lon - plon) * KM_LON)
  }
  // Relief : une grande ondulation et des bosses régulières (≈ 6,5 m/km).
  const ele = Math.round(200 + 110 * Math.sin(t) + 32.4 * Math.sin((2 * Math.PI * dist) / 9.5))
  const time = new Date(START + (dist / SPEED) * 3600 * 1000).toISOString().replace('.000', '')
  pts.push([lat, lon, ele, time])
}

// Points d'intérêt (codes Openrunner) : 8 contrôles, 5 attention, 34 eau, 40 commerces, 95 curiosités.
const kinds = [
  ['1', 'Contrôle', 8],
  ['16', 'Attention', 4],
  ['15', 'Danger', 1],
  ['104', 'Point d’eau', 34],
  ['50', 'Commerce', 40],
  ['60', 'Curiosité', 95],
]
const wpts = []
let k = 0
for (const [sym, label, n] of kinds) {
  for (let j = 1; j <= n; j++) {
    const p = pts[Math.floor(((k * 7919) % 182) * ((N - 1) / 182))]
    k++
    wpts.push(
      `\t<wpt lat="${p[0].toFixed(6)}" lon="${(p[1] + 0.001).toFixed(6)}">\n\t\t<ele>0</ele>\n\t\t<name><![CDATA[${label} ${j}]]></name>\n\t\t<desc><![CDATA[]]></desc>\n\t\t<sym>${sym}</sym>\n\t</wpt>`,
    )
  }
}

const trk = pts
  .map(([lat, lon, ele, time]) => `\t\t<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">\n\t\t\t<ele>${ele}</ele>\n\t\t\t<time>${time}</time>\n\t\t</trkpt>`)
  .join('\n')

const gpx = `<?xml version="1.0" encoding="UTF-8" ?>
<gpx version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns="http://www.topografix.com/GPX/1/1"
    xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"
    creator="Openrunner - https://www.openrunner.com" >
${wpts.join('\n')}
\t<trk>
\t\t<name>BRM 600 _ Tour de Manche 2027-12345678</name>
\t\t<trkseg>
${trk}
\t\t</trkseg>
\t</trk>
</gpx>
`
const out = fileURLToPath(new URL('./boucle-600.gpx', import.meta.url))
writeFileSync(out, gpx)
console.log(`${out} : ${N} points, ${wpts.length} POI, ${dist.toFixed(1)} km`)
