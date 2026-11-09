import { Badge, type BadgeProps } from '@mantine/core'
import { sportColor } from '../labels'

/** Badge du sport, de la couleur de sa catégorie. */
export default function SportBadge({ sport, ...props }: { sport: string } & BadgeProps) {
  const c = sportColor(sport)
  return (
    <Badge variant="filled" tt="none" {...props} style={{ background: c.bg, color: c.fg, ...props.style }}>
      {sport}
    </Badge>
  )
}
