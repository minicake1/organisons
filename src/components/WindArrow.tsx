import type { Wind } from '../api'
import { windArrowDeg } from '../labels'

/** Petite flèche indiquant dans quel sens souffle le vent idéal. */
export default function WindArrow({ wind, size = 13 }: { wind: Wind; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: `rotate(${windArrowDeg(wind)}deg)` }}
    >
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  )
}
