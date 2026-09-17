import type { RegionCode } from '../../regions/config'

// ---------------------------------------------------------------------
// Country flags as SVG, because emoji ones do not exist on Windows.
//
// 🇦🇪 is two regional-indicator characters, and a font without the flag
// glyph falls back to rendering the letters themselves — so on Windows
// every flag on the site read as "AE", "PK", "US". Which looks exactly
// like a deliberate country code, and is why nobody noticed it was a
// font problem rather than a design decision.
//
// Drawn rather than imported: three flags at this size cost less inline
// than a request for an icon set, and they cannot fail to load.
// ---------------------------------------------------------------------

export default function Flag({
  code,
  className = 'h-3.5 w-5',
}: {
  code: RegionCode
  className?: string
}) {
  const shared = {
    viewBox: '0 0 30 20',
    className: `${className} inline-block flex-none align-middle rounded-[2px] ring-1 ring-ink/15`,
    role: 'img' as const,
    'aria-hidden': true,
  }

  if (code === 'ae') {
    // UAE: red hoist bar, then green / white / black bands.
    return (
      <svg {...shared}>
        <rect width="30" height="20" fill="#fff" />
        <rect width="30" height="6.67" fill="#00732f" />
        <rect y="13.33" width="30" height="6.67" fill="#000" />
        <rect width="7.5" height="20" fill="#ff0000" />
      </svg>
    )
  }

  if (code === 'pk') {
    // Pakistan: white hoist bar, dark green field, crescent and star.
    return (
      <svg {...shared}>
        <rect width="30" height="20" fill="#01411c" />
        <rect width="7.5" height="20" fill="#fff" />
        <g fill="#fff">
          <circle cx="19.2" cy="10" r="5.2" />
          <circle cx="21" cy="8.4" r="5.2" fill="#01411c" />
          <path d="M22.9 6.2l.62 1.7 1.78.08-1.4 1.12.47 1.73-1.47-1-1.47 1 .47-1.73-1.4-1.12 1.78-.08z" />
        </g>
      </svg>
    )
  }

  // United States: thirteen stripes and a canton. The stars are a dot
  // grid rather than drawn stars — at 20px tall a real star is mush.
  return (
    <svg {...shared}>
      <rect width="30" height="20" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((y) => (
        <rect key={y} y={(y * 20) / 13} width="30" height={20 / 13} fill="#b22234" />
      ))}
      <rect width="12" height={(20 / 13) * 7} fill="#3c3b6e" />
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3, 4].map((col) => (
          <circle
            key={`${row}-${col}`}
            cx={1.4 + col * 2.4}
            cy={1.2 + row * 2.4}
            r="0.62"
            fill="#fff"
          />
        )),
      )}
    </svg>
  )
}
