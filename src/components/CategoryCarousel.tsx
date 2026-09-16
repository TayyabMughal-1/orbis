import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../api/client'
import { CATEGORIES } from '../api/db'
import { useAsync } from '../lib/useAsync'
import { useRegion } from '../regions/RegionContext'
import { formatMoney } from '../lib/money'
import type { Product } from '../types'

// ---------------------------------------------------------------------
// Departments, as a 3D cylinder carousel.
//
// The cylinder's axis is horizontal, so the cards roll vertically past
// the camera — front face at centre, tipping onto their backs as they
// leave, then off the top and bottom edges.
//
// Every frame is computed in one requestAnimationFrame loop that writes
// transforms straight to the DOM. Nothing here goes through React state:
// re-rendering five cards at 60fps would be the one thing guaranteed to
// make it stutter.
//
// Three things keep it honest as a storefront rather than a demo:
//   • each card is a real <Link>, so the departments stay crawlable and
//     keyboard-reachable, and there is a plain text row beneath as well
//   • the loop is parked whenever the section is off-screen, so it costs
//     nothing while a visitor reads the rest of the page
//   • reduced-motion visitors get no autoplay and no parallax — the
//     carousel becomes a stepper they drive themselves
// ---------------------------------------------------------------------

/** Card face ratio — the standard 85.6 × 53.98 mm card. */
const CARD_RATIO = 1.5925

/** Perspective depth. Must match the wrapper's CSS perspective. */
const PERSPECTIVE = 1350

/**
 * Advance per frame. At 60fps this is one department roughly every five
 * seconds — slow enough to read a card, quick enough that the section
 * never looks stalled.
 */
const AUTO_SPEED = 0.0034

/**
 * Shapes the magnetic step: the card dwells at centre, then accelerates
 * away. Higher = longer dwell and a sharper snap. The reference value
 * of 4.2 holds a card still for about seven seconds, which on a page a
 * customer is scrolling past reads as frozen rather than deliberate;
 * 3.0 keeps the same character with a ~2.5s pause.
 */
const DWELL_EXPONENT = 3.0

/**
 * How far the next card sits from the centre one, as a multiple of card
 * height.
 *
 * This is not a gap — it is the distance between card *centres*, and it
 * has to account for two things that shrink the neighbour on screen: it
 * is rotated 132° about X, so it projects to only cos(132°) ≈ 0.67 of
 * its height, and it sits further back in Z, so perspective shrinks it
 * again. Spacing them a full card height apart (the obvious value)
 * therefore leaves a ~60px band of nothing between them. 0.96 closes
 * that to a few pixels and the cards read as one stack.
 */
const NEIGHBOUR_OFFSET = 0.96

/** Stage height as a multiple of card height. */
const STAGE_RATIO = 2.4

/** Card rotation at the first neighbour position, in degrees. */
const NEIGHBOUR_ROTATION = 132

/**
 * Volumetric thickness: five slices stacked across ~3px of Z. Cheaper
 * and sharper than a real extrusion, and at this scale indistinguishable.
 */
const THICKNESS_LAYERS = [-1.47, -0.73, 0, 0.73, 1.47]

const smoothstep = (t: number) => t * t * (3 - 2 * t)

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

export default function CategoryCarousel({ intro }: { intro?: React.ReactNode }) {
  const { region, config, href } = useRegion()
  const { data: products } = useAsync(() => api.listProducts({ region }), [region])

  const cardCount = CATEGORIES.length

  // ------------------------------------------------------------- refs
  const stageRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const frameId = useRef(0)

  const progress = useRef(0)
  /** Set by the prev/next buttons; the loop eases towards it, then clears. */
  const target = useRef<number | null>(null)
  const running = useRef(false)
  const paused = useRef(false)
  const mouse = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 })

  const [reduced, setReduced] = useState(prefersReducedMotion)
  const [active, setActive] = useState(0)

  const [metrics, setMetrics] = useState({ cardW: 336, cardH: 211, stageH: 600 })

  // --------------------------------------------------- per-card stats
  //
  // Stays null until the catalogue actually arrives. Folding a pending
  // or failed request into an empty array would render a confident
  // "0 products" on every department — worse than showing nothing,
  // because it looks like an answer.
  const stats = useMemo(() => {
    if (!products) return null
    const rows: Record<string, { count: number; from: number | null }> = {}
    for (const cat of CATEGORIES) {
      const inCat = products.filter((p: Product) => p.category === cat.id)
      const prices = inCat.flatMap((p) => p.variants.map((v) => v.price[region]))
      rows[cat.id] = { count: inCat.length, from: prices.length ? Math.min(...prices) : null }
    }
    return rows
  }, [products, region])

  // ------------------------------------------------------ motion pref
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  // ----------------------------------------------------------- sizing
  useEffect(() => {
    function measure() {
      const w = window.innerWidth
      const h = window.innerHeight

      let cardW: number
      if (w < 640) {
        // On a phone the carousel is the whole width, so size to the
        // viewport and leave a gutter wide enough for the stepper.
        cardW = Math.min(300, w - 110)
      } else {
        cardW = Math.round(w * 0.17 + 140)
        const heightFactor = Math.min(1, Math.max(0.65, h / 850))
        cardW = Math.round(cardW * heightFactor)
      }
      cardW = Math.min(380, Math.max(190, cardW))

      const cardH = Math.round(cardW / CARD_RATIO)
      // The centre card plus a good slice of the neighbour above and
      // below — enough to read them, not so much that the section turns
      // into a column of gaps.
      const stageH = Math.min(580, Math.max(390, Math.round(cardH * STAGE_RATIO)))

      setMetrics({ cardW, cardH, stageH })
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // --------------------------------------------------- mouse parallax
  useEffect(() => {
    if (reduced) return

    function onMove(e: MouseEvent) {
      const rx = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2)
      const ry = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2)
      mouse.current.targetX = Math.max(-1, Math.min(1, rx))
      mouse.current.targetY = Math.max(-1, Math.min(1, ry))
    }
    function onLeave() {
      mouse.current.targetX = 0
      mouse.current.targetY = 0
    }

    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [reduced])

  // ------------------------------------------------------- the layout
  const layout = useCallback(() => {
    const { cardH, stageH } = metrics

    if (target.current !== null) {
      // A prev/next press: ease to the requested card, then hand back.
      const delta = target.current - progress.current
      if (reduced || Math.abs(delta) < 0.002) {
        progress.current = target.current
        target.current = null
      } else {
        progress.current += delta * 0.075
      }
    } else if (!paused.current && !reduced) {
      progress.current += AUTO_SPEED
    }

    if (!reduced) {
      // Inertia: the tilt lags a little behind the cursor.
      mouse.current.x += (mouse.current.targetX - mouse.current.x) * 0.08
      mouse.current.y += (mouse.current.targetY - mouse.current.y) * 0.08
    }

    const continuous = progress.current
    const rounded = Math.round(continuous)
    const diff = continuous - rounded

    // Magnetic step: the card dwells at centre, then accelerates away.
    const eased = Math.sign(diff) * Math.pow(Math.abs(diff) * 2, DWELL_EXPONENT) / 2
    const virtualIndex = rounded + eased

    const nextActive = ((rounded % cardCount) + cardCount) % cardCount
    setActive((prev) => (prev === nextActive ? prev : nextActive))

    // Distance between card centres, and how far past the stage edge a
    // leaving card is pushed before it is clipped away.
    const step = cardH * NEIGHBOUR_OFFSET
    const peek = -55 * (cardH / 211)

    for (let i = 0; i < cardCount; i++) {
      const card = cardRefs.current[i]
      if (!card) continue

      // Shortest way round the cylinder.
      let offset = i - virtualIndex
      const half = cardCount / 2
      while (offset > half) offset -= cardCount
      while (offset < -half) offset += cardCount

      const abs = Math.abs(offset)
      const sign = Math.sign(offset)

      if (abs > 3) {
        card.style.visibility = 'hidden'
        card.style.pointerEvents = 'none'
        continue
      }
      card.style.visibility = 'visible'

      let y = 0
      let z = 0
      let rot = 0

      if (abs <= 1) {
        // Centre → first neighbour.
        const t = smoothstep(abs)
        y = -sign * (t * step)
        z = 400 + t * (220 - 400)
        rot = t * NEIGHBOUR_ROTATION
      } else if (abs <= 2) {
        // Neighbour → peeking at the stage edge.
        const t = smoothstep(abs - 1)
        const yStart = step
        const zEnd = -60

        // Perspective-aware, so the card's edge lands exactly on the
        // boundary however far back it has travelled.
        const sEnd = PERSPECTIVE / (PERSPECTIVE - zEnd)
        const yEnd = (stageH / 2 - peek) / sEnd - cardH / 2

        y = -sign * (yStart + t * (yEnd - yStart))
        z = 220 + t * (zEnd - 220)
        rot = NEIGHBOUR_ROTATION + t * (175 - NEIGHBOUR_ROTATION)
      } else {
        // Peeking → fully clear of the stage.
        const t = smoothstep(Math.min(abs - 2, 1))
        const zStart = -60
        const zEnd = -250

        const sStart = PERSPECTIVE / (PERSPECTIVE - zStart)
        const yStart = (stageH / 2 - peek) / sStart - cardH / 2
        const sEnd = PERSPECTIVE / (PERSPECTIVE - zEnd)
        const yEnd = (stageH / 2 + 100) / sEnd + cardH / 2

        y = -sign * (yStart + t * (yEnd - yStart))
        z = zStart + t * (zEnd - zStart)
        rot = 175 + t * (195 - 175)
      }

      // Parallax only bites on the card at the front.
      const centreFactor = Math.max(0, 1 - abs)
      const tiltX = -mouse.current.y * 12 * centreFactor
      const tiltY = mouse.current.x * 15 * centreFactor

      card.style.zIndex = String(Math.round(z))
      card.style.transform =
        `translateY(${y.toFixed(2)}px) translateZ(${z.toFixed(2)}px) ` +
        `rotateX(${(-sign * rot + tiltX).toFixed(2)}deg) ` +
        `rotateY(${tiltY.toFixed(2)}deg) rotateZ(-3deg)`

      // Only the card actually facing the visitor is clickable — the
      // ones tipped away are behind it and must not steal the pointer.
      card.style.pointerEvents = centreFactor > 0.55 ? 'auto' : 'none'
    }
  }, [metrics, cardCount, reduced])

  // ------------------------------------ run only while on screen
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    function tick() {
      layout()
      frameId.current = requestAnimationFrame(tick)
    }
    function start() {
      if (running.current) return
      running.current = true
      frameId.current = requestAnimationFrame(tick)
    }
    function stop() {
      running.current = false
      cancelAnimationFrame(frameId.current)
    }

    // One layout pass immediately, so nothing is unpositioned on mount.
    layout()

    if (typeof IntersectionObserver === 'undefined') {
      start()
      return stop
    }

    const observer = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0.05 },
    )
    observer.observe(stage)

    return () => {
      observer.disconnect()
      stop()
    }
  }, [layout])

  const step = useCallback((dir: 1 | -1) => {
    target.current = Math.round(progress.current) + dir
  }, [])

  const goTo = useCallback(
    (index: number) => {
      // Take the shortest way round rather than unwinding the whole ring.
      const current = Math.round(progress.current)
      const currentSlot = ((current % cardCount) + cardCount) % cardCount
      let delta = index - currentSlot
      if (delta > cardCount / 2) delta -= cardCount
      if (delta < -cardCount / 2) delta += cardCount
      target.current = current + delta
    },
    [cardCount],
  )

  const { cardW, cardH, stageH } = metrics
  const activeCategory = CATEGORIES[active] ?? CATEGORIES[0]
  const activeStats = stats?.[activeCategory.id] ?? null

  return (
    <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-12">
      <div className="order-1 lg:order-none">
        {intro}

        {/* Reads out whichever card is at the front. The fixed height
            stops the column jumping as blurbs of different lengths swap
            in, and re-keying replays the fade on each change. */}
        <div className="mt-7 min-h-[104px] border-l-2 border-accent/40 pl-4">
          <div key={activeCategory.id} className="animate-fade-in">
            <div className="font-grotesk text-[14px] uppercase tracking-wide text-accent">
              {activeCategory.label}
            </div>
            <p className="mt-1.5 max-w-[32rem] font-mono text-[12px] leading-relaxed text-muted">
              {activeCategory.blurb}
            </p>
            {activeStats && (
              <div className="mt-2 font-mono text-[11px] uppercase text-muted">
                {activeStats.count} product{activeStats.count === 1 ? '' : 's'}
                {activeStats.from != null && <> · from {formatMoney(activeStats.from, config, true)}</>}
              </div>
            )}
          </div>
        </div>

        {/* Plain, always-visible department links. They keep the section
            usable without touching the carousel, and crawlable without a
            search engine having to run the 3D scene at all. */}
        <div className="mt-7 flex flex-wrap gap-2">
          {CATEGORIES.map((cat, i) => (
            <Link
              key={cat.id}
              to={href(`/shop/${cat.id}`)}
              onMouseEnter={() => goTo(i)}
              onFocus={() => goTo(i)}
              aria-current={active === i ? 'true' : undefined}
              className={`group flex items-center gap-1.5 rounded-full border px-4 py-2 font-mono text-[11px] uppercase transition-colors ${
                active === i
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-white/15 text-muted hover:border-white/35 hover:text-ink'
              }`}
            >
              {cat.label}
              <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </div>

      <div
        ref={stageRef}
        onMouseEnter={() => (paused.current = true)}
        onMouseLeave={() => (paused.current = false)}
        className="relative order-2 w-full select-none lg:order-none lg:w-[var(--stage-w)]"
        style={
          {
            height: `${stageH}px`,
            // Card width plus a lane on the right for the stepper. The
            // cards sit at the left edge of this box on desktop, so the
            // only space between them and the copy is the grid gap.
            '--stage-w': `${cardW + 80}px`,
          } as React.CSSProperties
        }
      >
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ perspective: `${PERSPECTIVE}px` }}
        >
          {/* Fades the cards out as they reach the top and bottom edges */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[500]"
            style={{
              background:
                // Fades the strip into the page at both ends, so it must be the
                // page colour rather than a colour of its own.
                'linear-gradient(to bottom, #ffffff 0%, rgba(255,255,255,0) 9%, rgba(255,255,255,0) 91%, #ffffff 100%)',
            }}
          />

          <div className="absolute inset-0 flex items-center justify-center lg:justify-start">
          <div
            className="relative"
            style={{ width: `${cardW}px`, height: `${cardH}px`, transformStyle: 'preserve-3d' }}
          >
            {CATEGORIES.map((cat, i) => {
              const row = stats?.[cat.id] ?? null
              return (
                <Link
                  key={cat.id}
                  ref={(el) => {
                    cardRefs.current[i] = el
                  }}
                  to={href(`/shop/${cat.id}`)}
                  aria-label={`Shop ${cat.label}`}
                  className="absolute inset-0 rounded-[16px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neon"
                  style={{
                    width: `${cardW}px`,
                    height: `${cardH}px`,
                    transformStyle: 'preserve-3d',
                    backfaceVisibility: 'visible',
                  }}
                  onFocus={() => goTo(i)}
                >
                  {THICKNESS_LAYERS.map((zOffset, layerIdx) => {
                    const isFront = layerIdx === THICKNESS_LAYERS.length - 1
                    const isBack = layerIdx === 0

                    // Structural middle slices — the card's edge.
                    if (!isFront && !isBack) {
                      return (
                        <div
                          key={layerIdx}
                          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[16px] border border-[#5c6172]"
                          style={{
                            backgroundColor: '#5c6172',
                            transform: `translateZ(${zOffset}px)`,
                          }}
                        />
                      )
                    }

                    if (isFront) {
                      return (
                        <div
                          key={layerIdx}
                          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[16px] border border-white/15"
                          style={{
                            backgroundColor: '#0f0f0f',
                            transform: `translateZ(${zOffset}px)`,
                            backfaceVisibility: 'hidden',
                            boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.15)',
                          }}
                        >
                          <video
                            src={cat.video}
                            autoPlay
                            loop
                            muted
                            playsInline
                            preload="metadata"
                            className="absolute inset-0 h-full w-full rounded-[16px] object-cover"
                          />

                          <div className="absolute inset-0 z-10 h-full w-full bg-gradient-to-t from-black/75 via-black/25 to-black/40 p-5">
                            {/* Brushed-metal emblem, mid-left */}
                            <div className="absolute left-5 top-1/2 -translate-y-1/2">
                              <Emblem id={cat.id} />
                            </div>

                            {/* Wordmark, top-right */}
                            <div className="absolute right-5 top-5 text-right">
                              <div className="font-grotesk text-[13px] uppercase leading-none tracking-[0.08em] text-white/95">
                                Orbis <span className="text-white/60">Store</span>
                              </div>
                              <div className="mt-1 font-jetbrains text-[8px] uppercase tracking-[0.28em] text-white/50">
                                {config.countryCode}
                              </div>
                            </div>

                            {/* Department, bottom-left */}
                            <div className="absolute bottom-5 left-5 right-16">
                              <h3 className="font-grotesk text-[22px] uppercase leading-none text-white">
                                {cat.label}
                              </h3>
                              <p className="mt-1.5 font-jetbrains text-[9px] uppercase tracking-[0.14em] text-white/60">
                                {row ? (
                                  <>
                                    {row.count} product{row.count === 1 ? '' : 's'}
                                    {row.from != null && (
                                      <> · from {formatMoney(row.from, config, true)}</>
                                    )}
                                  </>
                                ) : (
                                  cat.strapline
                                )}
                              </p>
                            </div>

                            {/* Intersecting circles, bottom-right */}
                            <div className="absolute bottom-5 right-5 flex -space-x-3 items-center opacity-90">
                              <div className="h-5 w-5 rounded-full border border-white/10 bg-white/20 backdrop-blur-[1px]" />
                              <div className="h-5 w-5 rounded-full border border-white/10 bg-white/35 backdrop-blur-[1px]" />
                            </div>
                          </div>
                        </div>
                      )
                    }

                    // Back face — same clip, blurred behind the details.
                    return (
                      <div
                        key={layerIdx}
                        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[16px] border border-white/15"
                        style={{
                          backgroundColor: '#0f0f0f',
                          transform: `translateZ(${zOffset}px) rotateX(180deg)`,
                          backfaceVisibility: 'hidden',
                          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.15)',
                        }}
                      >
                        <div
                          className="pointer-events-none absolute inset-0"
                          style={{ filter: 'blur(16px)', transform: 'scale(1.15)' }}
                        >
                          <video
                            src={cat.video}
                            autoPlay
                            loop
                            muted
                            playsInline
                            preload="metadata"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        </div>
                        <div className="absolute inset-0 bg-black/45" />

                        {/* Magnetic stripe */}
                        <div className="absolute left-0 right-0 top-4 z-10 h-8 bg-black/85 backdrop-blur-md" />

                        <div className="absolute bottom-5 left-5 right-5 z-20 flex flex-col gap-1 text-left font-jetbrains">
                          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-white">
                            {cat.label}
                          </div>
                          <div className="flex items-center gap-2 text-[8px] font-medium uppercase tracking-wide text-white/70">
                            <span>{cat.strapline}</span>
                            <span className="font-light text-white/40">•</span>
                            <span>Ships from {config.country}</span>
                          </div>
                          <div className="mt-0.5 text-[8px] uppercase tracking-wide text-white/45">
                            {config.policy.returnsDays}-day returns · {config.currency.code}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </Link>
              )
              })}
            </div>
          </div>
        </div>

        {/* Stepper — the only way through the carousel for anyone who
            has asked for reduced motion, so it is always present. It
            sits outside the clip so it is never cropped. */}
        <div className="absolute right-2 top-1/2 z-[600] flex -translate-y-1/2 flex-col gap-2 sm:right-6">
          <StepButton label="Previous department" onClick={() => step(-1)}>
            <ChevronUp size={16} />
          </StepButton>
          <StepButton label="Next department" onClick={() => step(1)}>
            <ChevronDown size={16} />
          </StepButton>
        </div>
      </div>
    </div>
  )
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="press flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-background/70 text-ink backdrop-blur-sm transition-colors hover:border-white/40 hover:text-accent"
    >
      {children}
    </button>
  )
}

/**
 * The brushed-metal mark on the card front. Same silver gradient
 * treatment as a card chip, but drawn as an Orbis emblem — an actual
 * payment chip on a "Lighting" card would read as a payment method.
 */
function Emblem({ id }: { id: string }) {
  const gradientId = `emblem-${id}`
  return (
    <svg
      className="h-[30px] w-[30px]"
      viewBox="0 0 60 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="30" y1="6" x2="30" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#8f8f8f" />
        </linearGradient>
      </defs>
      <circle cx="30" cy="30" r="23" stroke={`url(#${gradientId})`} strokeWidth="2.5" />
      <ellipse cx="30" cy="30" rx="23" ry="9" stroke={`url(#${gradientId})`} strokeWidth="1.5" opacity="0.75" />
      <circle cx="30" cy="30" r="7.5" fill={`url(#${gradientId})`} />
      <circle cx="24.5" cy="25.5" r="2.4" fill="#ffffff" opacity="0.9" />
    </svg>
  )
}
