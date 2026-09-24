import { Minus, Plus, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Rating } from '../../types'

// Small shared pieces: quantity control, skeletons, pills, empty and
// error states. Kept together because none of them is big enough to earn
// a file, and every page uses at least two.

export function QuantityStepper({
  value,
  max,
  onChange,
  size = 'md',
}: {
  value: number
  max: number
  onChange: (next: number) => void
  size?: 'sm' | 'md'
}) {
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  const box = size === 'sm' ? 'text-[14px]' : 'text-[14px]'

  return (
    <div className="inline-flex items-center rounded-full border border-ink/15 bg-ink/5">
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(value - 1)}
        className={`${dim} flex items-center justify-center rounded-full text-ink/80 transition-colors hover:text-ink disabled:opacity-30`}
        disabled={value <= 1}
      >
        <Minus size={14} strokeWidth={2} />
      </button>
      <span className={`${box} w-8 text-center font-body tabular-nums text-ink`}>{value}</span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(value + 1)}
        className={`${dim} flex items-center justify-center rounded-full text-ink/80 transition-colors hover:text-ink disabled:opacity-30`}
        disabled={value >= max}
      >
        <Plus size={14} strokeWidth={2} />
      </button>
    </div>
  )
}

/**
 * Star rating. Half-star precision via a clipped overlay rather than a
 * separate half-star glyph, so 4.7 actually looks like 4.7.
 *
 * The number and the count sit next to the stars deliberately: stars
 * alone tell a shopper almost nothing without the sample size.
 */
export function Stars({
  rating,
  size = 12,
  showCount = true,
  className = '',
}: {
  rating: Rating | null
  size?: number
  showCount?: boolean
  className?: string
}) {
  if (!rating) return null
  const pct = Math.max(0, Math.min(100, (rating.average / 5) * 100))

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className="relative inline-flex"
        role="img"
        aria-label={`Rated ${rating.average} out of 5 from ${rating.count} reviews`}
      >
        <span className="flex gap-[1px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} size={size} className="text-muted" fill="currentColor" strokeWidth={0} />
          ))}
        </span>
        <span
          className="absolute inset-0 flex gap-[1px] overflow-hidden"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} size={size} className="flex-none text-accent" fill="currentColor" strokeWidth={0} />
          ))}
        </span>
      </span>
      <span className="font-body text-[12px] text-muted">
        {rating.average.toFixed(1)}
        {showCount && <span className="text-muted"> ({rating.count})</span>}
      </span>
    </span>
  )
}

export function Pill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'neon' | 'warn' }) {
  const tones = {
    default: 'border-ink/15 bg-ink/5 text-ink/80',
    neon: 'border-accent/40 bg-accent/10 text-accent',
    warn: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 font-body text-[12px] uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function CardSkeleton() {
  return (
    <div className="liquid-glass shimmer rounded-[24px] p-4">
      <div className="aspect-square w-full rounded-[18px] bg-ink/5" />
      <div className="mt-4 h-3 w-2/3 rounded bg-ink/10" />
      <div className="mt-2 h-3 w-1/3 rounded bg-ink/5" />
    </div>
  )
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-[20px] border border-ink/10 bg-ink/[0.02] px-6 py-14 text-center">
      <h3 className="font-grotesk text-[16px] uppercase text-ink">{title}</h3>
      <p className="mx-auto mt-3 max-w-md font-body text-[14px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-[20px] border border-red-400/25 bg-red-500/5 px-6 py-10 text-center">
      <p className="font-body text-[14px] leading-relaxed text-red-200">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 font-body text-[13px] uppercase text-accent underline underline-offset-4"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  script,
  children,
}: {
  eyebrow?: string
  title: ReactNode
  script?: string
  children?: ReactNode
}) {
  return (
    <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="relative">
        {eyebrow && (
          <div className="mb-3 font-body text-[13px] uppercase tracking-[0.2em] text-muted">{eyebrow}</div>
        )}
        <h2 className="font-grotesk text-[30px] uppercase leading-[1.05] text-ink sm:text-[40px] lg:text-[52px]">
          {title}
        </h2>
        {/* In flow under the title, on the same left edge. Absolutely
            positioned against the right edge it drifted away from the
            heading it annotates and overlapped whatever followed;
            mix-blend-exclusion was there to punch through a dark page and
            only muddies a white one. */}
        {script && (
          <div className="pointer-events-none mt-2 -rotate-1 font-condiment text-[26px] normal-case leading-none text-accent sm:text-[34px]">
            {script}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
