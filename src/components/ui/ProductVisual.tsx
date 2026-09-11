import { useId } from 'react'
import type { VisualShape } from '../../types'

// ---------------------------------------------------------------------
// Product imagery, drawn rather than fetched.
//
// Real photography would replace this — swap MediaItem.kind 'render' for
// an <img> and nothing else changes. Until then these are deterministic
// SVG studio shots: same product, same render, every load, no external
// image host to break and nothing to download.
// ---------------------------------------------------------------------

type Props = {
  shape: VisualShape
  hue: number
  accent?: number
  className?: string
}

export default function ProductVisual({ shape, hue, accent, className = '' }: Props) {
  const uid = useId().replace(/:/g, '')
  const a = `hsl(${hue} 70% 62%)`
  const b = `hsl(${accent ?? hue + 40} 65% 40%)`
  const deep = `hsl(${hue} 55% 12%)`

  return (
    <svg
      viewBox="0 0 400 400"
      className={className}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id={`bg-${uid}`} cx="50%" cy="38%" r="72%">
          <stop offset="0%" stopColor={deep} />
          <stop offset="100%" stopColor="#03081c" />
        </radialGradient>
        <linearGradient id={`body-${uid}`} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor={a} />
          <stop offset="55%" stopColor={b} />
          <stop offset="100%" stopColor="#0a1030" />
        </linearGradient>
        <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={a} stopOpacity="0.55" />
          <stop offset="100%" stopColor={a} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`spec-${uid}`} cx="34%" cy="28%" r="34%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`soft-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>

      <rect width="400" height="400" fill={`url(#bg-${uid})`} />
      <circle cx="200" cy="180" r="150" fill={`url(#glow-${uid})`} />

      {shape === 'orb' && <Orb uid={uid} />}
      {shape === 'ring' && <Ring uid={uid} accentColor={a} />}
      {shape === 'monolith' && <Monolith uid={uid} />}
      {shape === 'prism' && <Prism uid={uid} />}
      {shape === 'wave' && <Wave uid={uid} accentColor={a} />}
      {shape === 'grid' && <Grid uid={uid} accentColor={a} />}

      {/* contact shadow, common to every shape */}
      <ellipse cx="200" cy="332" rx="92" ry="14" fill="#000" opacity="0.5" filter={`url(#soft-${uid})`} />
    </svg>
  )
}

function Orb({ uid }: { uid: string }) {
  return (
    <g>
      <circle cx="200" cy="192" r="104" fill={`url(#body-${uid})`} />
      <circle cx="200" cy="192" r="104" fill={`url(#spec-${uid})`} />
      <circle cx="200" cy="192" r="104" fill="none" stroke="#ffffff" strokeOpacity="0.16" />
      <path
        d="M110 232a104 104 0 0 0 180 0"
        fill="none"
        stroke="#000"
        strokeOpacity="0.28"
        strokeWidth="18"
      />
    </g>
  )
}

function Ring({ uid, accentColor }: { uid: string; accentColor: string }) {
  return (
    <g>
      <ellipse
        cx="200"
        cy="196"
        rx="110"
        ry="104"
        fill="none"
        stroke={`url(#body-${uid})`}
        strokeWidth="30"
      />
      <ellipse
        cx="200"
        cy="196"
        rx="110"
        ry="104"
        fill="none"
        stroke={accentColor}
        strokeOpacity="0.5"
        strokeWidth="2"
      />
      <ellipse cx="200" cy="196" rx="80" ry="74" fill="#03081c" opacity="0.55" />
      <path
        d="M118 150a110 104 0 0 1 92-58"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.45"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </g>
  )
}

function Monolith({ uid }: { uid: string }) {
  return (
    <g>
      <rect x="146" y="86" width="108" height="230" rx="10" fill={`url(#body-${uid})`} />
      <rect x="146" y="86" width="34" height="230" rx="10" fill="#fff" opacity="0.12" />
      <rect
        x="146"
        y="86"
        width="108"
        height="230"
        rx="10"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.18"
      />
      <rect x="146" y="86" width="108" height="60" rx="10" fill={`url(#spec-${uid})`} opacity="0.5" />
    </g>
  )
}

function Prism({ uid }: { uid: string }) {
  return (
    <g>
      <polygon points="200,74 306,300 94,300" fill={`url(#body-${uid})`} />
      <polygon points="200,74 306,300 200,300" fill="#000" opacity="0.22" />
      <polygon
        points="200,74 306,300 94,300"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.22"
        strokeWidth="1.5"
      />
      <polygon points="200,74 240,160 160,160" fill={`url(#spec-${uid})`} opacity="0.6" />
    </g>
  )
}

function Wave({ uid, accentColor }: { uid: string; accentColor: string }) {
  return (
    <g>
      <path
        d="M60 250c40-70 80-70 120 0s80 70 120 0 40-70 40-70v120H60z"
        fill={`url(#body-${uid})`}
        opacity="0.9"
      />
      {[0, 1, 2, 3].map((i) => (
        <path
          key={i}
          d={`M50 ${170 + i * 26}c44-56 88-56 132 0s88 56 132 0`}
          fill="none"
          stroke={accentColor}
          strokeOpacity={0.45 - i * 0.09}
          strokeWidth="2"
        />
      ))}
      <ellipse cx="200" cy="150" rx="58" ry="54" fill={`url(#body-${uid})`} />
      <ellipse cx="200" cy="150" rx="58" ry="54" fill={`url(#spec-${uid})`} />
    </g>
  )
}

function Grid({ uid, accentColor }: { uid: string; accentColor: string }) {
  const rows = [0, 1, 2, 3, 4, 5]
  const cols = [0, 1, 2, 3, 4, 5, 6]
  return (
    <g>
      <rect x="96" y="96" width="208" height="208" rx="18" fill={`url(#body-${uid})`} />
      <rect x="96" y="96" width="208" height="208" rx="18" fill="#fff" opacity="0.06" />
      <g opacity="0.85">
        {rows.map((r) =>
          cols.map((c) => (
            <circle
              key={`${r}-${c}`}
              cx={116 + c * 28}
              cy={116 + r * 34}
              r={2 + ((r + c) % 3) * 1.5}
              fill={(r + c) % 4 === 0 ? accentColor : '#EFF4FF'}
            />
          )),
        )}
      </g>
      <rect
        x="96"
        y="96"
        width="208"
        height="208"
        rx="18"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.2"
      />
      <rect x="96" y="96" width="208" height="80" rx="18" fill={`url(#spec-${uid})`} opacity="0.35" />
    </g>
  )
}
