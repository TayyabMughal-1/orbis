import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { Product } from '../types'
import { useRegion } from '../regions/RegionContext'
import Price from './ui/Price'
import Media from './ui/Media'

// ---------------------------------------------------------------------
// The hero carousel: product cards standing on a cylinder.
//
// Not a flat slider. Each card is placed on a ring of radius R with the
// camera at the ring's centre, so cards are tangent to the cylinder and
// every one faces the camera squarely. The slanted top edge you see on
// the outer cards is perspective, not rotation — which is why the sides
// stay vertical and the whole thing reads as depth rather than as a row
// of tilted rectangles.
//
// Two things drive it, and they add:
//   • a slow constant drift, so the ring is alive when nothing happens;
//   • scroll position, so moving down the page turns the ring.
//
// Every frame writes transforms straight to the DOM. Nothing here goes
// through React state: at 60fps a setState per frame would re-render the
// whole hero sixty times a second to move nine elements.
// ---------------------------------------------------------------------

/** Ring radius. Also the perspective depth — camera sits at the centre. */
const R = 660
/** Cards beyond this angle from the front are hidden, not drawn. */
const CULL = 52
/** Degrees per second of constant drift. Deliberately slow. */
const DRIFT = 2.4
/** Degrees of rotation per pixel scrolled. */
const PER_PIXEL = 0.055
/** How many card slots go round the ring. */
const SLOTS = 22

export default function HeroRing({ products }: { products: Product[] }) {
  const ringRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const phase = useRef(0)
  const scrollPhase = useRef(0)
  const frame = useRef<number>()
  const last = useRef(0)

  const { region, href } = useRegion()

  useEffect(() => {
    if (products.length === 0) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const step = 360 / SLOTS

    function place() {
      const total = phase.current + scrollPhase.current
      for (let i = 0; i < cardRefs.current.length; i += 1) {
        const el = cardRefs.current[i]
        if (!el) continue

        // Signed angle in -180..180 so the cull is symmetrical about the front.
        const a = (((i * step + total) % 360) + 540) % 360 - 180

        if (Math.abs(a) > CULL) {
          el.style.visibility = 'hidden'
          continue
        }
        el.style.visibility = 'visible'

        const r = (a * Math.PI) / 180
        const c = Math.cos(r)

        // x sweeps across the front of the cylinder; z pushes the card
        // toward the camera as it reaches the edges, which is what makes
        // the outer cards larger and the front one sit furthest back.
        el.style.transform =
          `translate3d(${(R * Math.sin(r)).toFixed(2)}px, 0, ${(R * (1 - c)).toFixed(2)}px) ` +
          `rotateY(${(-a).toFixed(2)}deg)`

        // The front card is the subject: everything else steps back.
        const away = Math.abs(a) / CULL
        el.style.opacity = (1 - away * 0.45).toFixed(3)
        el.style.filter = `saturate(${(1 - away * 0.4).toFixed(2)}) brightness(${(1 - away * 0.06).toFixed(2)})`
        // Nearer the front means nearer the camera means on top.
        el.style.zIndex = String(100 - Math.round(Math.abs(a)))
      }
    }

    function onScroll() {
      scrollPhase.current = -window.scrollY * PER_PIXEL
      // Under reduced motion the drift is off, so scroll is the only thing
      // that moves the ring — it still has to repaint on scroll.
      if (reduce.matches) place()
    }

    function tick(t: number) {
      if (!last.current) last.current = t
      // Clamped: a backgrounded tab must not bank up seconds of drift and
      // then snap forward when it returns.
      const dt = Math.min((t - last.current) / 1000, 0.1)
      last.current = t
      if (!reduce.matches) phase.current -= DRIFT * dt
      place()
      frame.current = requestAnimationFrame(tick)
    }

    function onVisibility() {
      last.current = 0
    }

    onScroll()
    place()
    frame.current = requestAnimationFrame(tick)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [products])

  if (products.length === 0) return null

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[330px] sm:h-[380px]"
      aria-hidden="true"
    >
      <div
        ref={ringRef}
        className="absolute left-1/2 top-0 h-full w-0"
        style={{
          perspective: `${R}px`,
          // The vanishing point sits well below the cards, so the ring is
          // seen slightly from above and the cards stand up rather than
          // fanning out flat.
          perspectiveOrigin: '50% 150%',
          transformStyle: 'preserve-3d',
        }}
      >
        {Array.from({ length: SLOTS }).map((_, i) => {
          const product = products[i % products.length]
          return (
            <Link
              key={i}
              to={href(`/product/${product.slug}`)}
              tabIndex={-1}
              ref={(el) => {
                cardRefs.current[i] = el
              }}
              className="pointer-events-auto absolute left-0 top-6 -ml-[75px] block h-[252px] w-[150px] overflow-hidden rounded-[16px] border border-ink/[0.07] bg-background shadow-card"
              style={{ backfaceVisibility: 'hidden', willChange: 'transform' }}
            >
              <div className="relative h-[176px] w-full overflow-hidden bg-surface">
                <Media item={product.media[0]} />
              </div>
              <div className="px-3 pt-2.5">
                <div className="truncate font-grotesk text-[11px] uppercase leading-tight text-ink">
                  {product.name}
                </div>
                <Price
                  amount={Math.min(...product.variants.map((v) => v.price[region]))}
                  className="mt-1 block font-mono text-[11px] text-accent"
                />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
