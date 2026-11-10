import { useState } from 'react'
import { ActionIcon, Box, Group, NumberInput, ScrollArea, Stack, Text } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import { IconMinus, IconPlus } from '@tabler/icons-react'
import type { WorkoutBlock, WorkoutSummary } from '../api'
import { niceStep } from '../labels'
import { zoneColor } from './WorkoutChart'

const FTP_KEY = 'organisons.ftp'

function savedFtp(): number {
  try {
    const v = Number(localStorage.getItem(FTP_KEY))
    return v > 50 && v < 600 ? v : 250
  } catch {
    return 250
  }
}

/** « 05:00 » pour 300 s. */
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** Texte d'un bloc : puissance en watts (ou % FTP) et nature. */
function target(b: WorkoutBlock, ftp: number | null) {
  const v = (p: number) => (ftp ? `${Math.round(p * ftp)} W` : `${Math.round(p * 100)} %`)
  switch (b.kind) {
    case 'warmup':
      return `Échauffement ${v(b.from)} → ${v(b.to)}`
    case 'cooldown':
      return `Retour au calme ${v(b.from)} → ${v(b.to)}`
    case 'ramp':
      return `Rampe ${v(b.from)} → ${v(b.to)}`
    case 'free':
      return 'Roue libre'
    case 'max':
      return 'Effort maximal'
    default:
      return v(b.from)
  }
}

/**
 * Vue détaillée d'une séance : liste des blocs (durée, puissance, couleur de la
 * zone) et profil avec les axes : puissance (% FTP ou watts) en ordonnée, temps
 * en abscisse. La FTP est réglable et mémorisée sur ce PC.
 */
export default function WorkoutDetail({ workout }: { workout: WorkoutSummary }) {
  const [ftp, setFtpState] = useState<number>(savedFtp)
  const [watts, setWatts] = useState(true)
  const setFtp = (v: number) => {
    const f = Math.max(50, Math.min(600, Math.round(v)))
    setFtpState(f)
    try {
      localStorage.setItem(FTP_KEY, String(f))
    } catch {
      // mémoire du navigateur indisponible : la FTP vaut pour cette fois
    }
  }
  const unitFtp = watts ? ftp : null

  return (
    <Group align="stretch" gap="md" wrap="nowrap">
      <Stack gap={4} w={300} style={{ flex: "none" }}>
        <ScrollArea h="min(60vh, 520px)" offsetScrollbars>
          <Stack gap={3}>
            {workout.blocks.map((b, i) => {
              const mid = (b.from + b.to) / 2
              const bg = b.kind === 'free' ? '#dee2e6' : zoneColor(mid)
              const dark = b.kind === 'free' || mid < 0.6 || (mid >= 0.9 && mid < 1.05)
              return (
                <Group key={i} gap={0} wrap="nowrap" style={{ borderRadius: 4, overflow: 'hidden', border: '1px solid #e9ecef' }}>
                  <Text size="sm" w={70} ta="center" py={3} bg="white" style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
                    {mmss(b.duration)}
                  </Text>
                  <Text size="sm" fw={600} py={3} px={8} style={{ flex: 1, background: bg, color: dark ? '#212529' : '#fff' }} lineClamp={1}>
                    {target(b, unitFtp)}
                    {b.cadence ? ` · ${b.cadence} tr/min` : ''}
                  </Text>
                </Group>
              )
            })}
          </Stack>
        </ScrollArea>
      </Stack>
      <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
        <PowerAxisChart blocks={workout.blocks} ftp={unitFtp} />
        <Group gap="sm">
          <Text size="sm" fw={600}>
            FTP
          </Text>
          <ActionIcon variant="default" aria-label="FTP −5 W" onClick={() => setFtp(ftp - 5)}>
            <IconMinus size={14} />
          </ActionIcon>
          <NumberInput
            w={90}
            size="xs"
            aria-label="FTP en watts"
            value={ftp}
            min={50}
            max={600}
            suffix=" W"
            hideControls
            onChange={(v) => typeof v === 'number' && setFtp(v)}
          />
          <ActionIcon variant="default" aria-label="FTP +5 W" onClick={() => setFtp(ftp + 5)}>
            <IconPlus size={14} />
          </ActionIcon>
          <Text
            size="xs"
            c="blue"
            ml="sm"
            style={{ cursor: 'pointer' }}
            onClick={() => setWatts((v) => !v)}
          >
            {watts ? 'Afficher en % de FTP' : 'Afficher en watts'}
          </Text>
        </Group>
      </Stack>
    </Group>
  )
}

/** Profil avec axes : puissance en ordonnée (% FTP ou W), temps en abscisse. */
function PowerAxisChart({ blocks, ftp }: { blocks: WorkoutBlock[]; ftp: number | null }) {
  const { ref, width } = useElementSize()
  const W = Math.max(300, width)
  // Hauteur proportionnelle à la largeur (pas de profil écrasé ni étiré).
  const H = Math.round(Math.min(460, Math.max(240, W * 0.38)))
  const L = 52
  const R = 10
  const T = 10
  const B = 28
  const total = blocks.reduce((m, b) => Math.max(m, b.start + b.duration), 0) || 1
  const top = Math.ceil(Math.max(1.25, ...blocks.map((b) => Math.max(b.from, b.to))) * 4) / 4
  const x = (s: number) => L + (s / total) * (W - L - R)
  const y = (p: number) => T + (1 - p / top) * (H - T - B)
  const yTicks: number[] = []
  for (let p = 0; p <= top + 1e-9; p += 0.25) yTicks.push(p)
  const stepMin = niceStep(total / 60 / Math.max(3, Math.floor((W - L - R) / 70)), [1, 2, 5, 10, 15, 20, 30, 60])
  const xTicks: number[] = []
  for (let m = 0; m * 60 <= total; m += stepMin) xTicks.push(m)
  const label = (p: number) => (ftp ? `${Math.round(p * ftp)} W` : `${Math.round(p * 100)} %`)
  return (
    <Box ref={ref} style={{ width: '100%' }}>
      {width > 0 && (
        <svg width={W} height={H} style={{ display: 'block' }} aria-label="Profil de puissance avec axes">
          {yTicks.map((p) => (
            <g key={p}>
              <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} stroke={Math.abs(p - 1) < 1e-9 ? '#adb5bd' : '#f1f3f5'} strokeDasharray={Math.abs(p - 1) < 1e-9 ? '5 4' : undefined} />
              <text x={L - 6} y={y(p) + 4} textAnchor="end" fontSize={11} fill="#5c636a">
                {label(p)}
              </text>
            </g>
          ))}
          {blocks.map((b, i) => (
            <polygon
              key={i}
              points={`${x(b.start)},${y(0)} ${x(b.start)},${y(b.from)} ${x(b.start + b.duration)},${y(b.to)} ${x(b.start + b.duration)},${y(0)}`}
              fill={b.kind === 'free' ? '#dee2e6' : zoneColor((b.from + b.to) / 2)}
              stroke="#fff"
              strokeWidth={1}
            >
              <title>{`${mmss(b.duration)} · ${target(b, ftp)}`}</title>
            </polygon>
          ))}
          <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#868e96" />
          {xTicks.map((m) => (
            <g key={m}>
              <line x1={x(m * 60)} x2={x(m * 60)} y1={y(0)} y2={y(0) + 5} stroke="#868e96" />
              <text x={x(m * 60)} y={H - 8} textAnchor="middle" fontSize={11} fill="#5c636a">
                {m === 0 ? '0' : m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`}
              </text>
            </g>
          ))}
        </svg>
      )}
    </Box>
  )
}
