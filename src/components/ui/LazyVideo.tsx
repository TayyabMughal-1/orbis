import { useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------
// A video that does not download until it is worth downloading.
//
// The catalogue's clips total around 114MB against 120KB of JS, so they
// are the whole performance story and nothing else comes close. A plain
// <video autoplay loop> fetches the entire file immediately — preload
// hints are ignored once autoplay is set, because the browser needs the
// data to honour it — and the home page was doing that six times over
// before a shopper had scrolled anywhere.
//
// Three rules, in order:
//
//   1. Nothing loads off-screen. An IntersectionObserver attaches the src
//      only when the element is near the viewport, so a visitor who never
//      scrolls past the hero never pays for the rest.
//   2. Above-the-fold clips wait for idle. The hero is on screen
//      immediately, so an observer would not help; it loads once the
//      browser is quiet instead, which keeps 17MB off the critical path
//      while the page paints.
//   3. Some visitors never get video at all — Data Saver, a 2g-class
//      connection, or a reduced-motion preference. They get the poster,
//      which is the honest outcome rather than a stalled frame.
// ---------------------------------------------------------------------

type Props = {
  src: string
  className?: string
  /**
   * True for anything already on screen at load. Waits for idle instead
   * of for an intersection, which would fire instantly and defeat itself.
   */
  eager?: boolean
  /** Still frame shown before — and instead of — the video. */
  poster?: string
  /** Shown while there is no video: a gradient, a render, anything. */
  fallback?: React.ReactNode
}

/** True when the visitor has asked for less data or is on a slow link. */
function shouldSkipVideo(): boolean {
  if (typeof navigator === 'undefined') return false
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  if (!connection) return false
  if (connection.saveData) return true
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

export default function LazyVideo({ src, className = '', eager = false, poster, fallback }: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const [load, setLoad] = useState(false)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || shouldSkipVideo()) return

    if (eager) {
      // requestIdleCallback where it exists, a timeout where it does not
      // (Safari). Either way the video is fetched after first paint, not
      // in competition with it.
      const idle = (
        window as Window & { requestIdleCallback?: (cb: () => void, o?: object) => number }
      ).requestIdleCallback
      if (idle) {
        const id = idle(() => setLoad(true), { timeout: 2500 })
        return () => {
          const cancel = (window as Window & { cancelIdleCallback?: (h: number) => void })
            .cancelIdleCallback
          cancel?.(id)
        }
      }
      const timer = window.setTimeout(() => setLoad(true), 900)
      return () => window.clearTimeout(timer)
    }

    const node = holder.current
    if (!node) return
    if (!('IntersectionObserver' in window)) {
      setLoad(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLoad(true)
          observer.disconnect()
        }
      },
      // Start a little before it scrolls in, so it is playing by the time
      // it is actually looked at.
      { rootMargin: '300px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [eager])

  // The inner video is absolute, so the wrapper has to establish a
  // containing block — but only add `relative` when the caller has not
  // already positioned it. Tailwind emits .relative after .absolute, so a
  // hardcoded `relative` wins over an `absolute` passed in through
  // className regardless of the order they appear in the string, which
  // silently stopped the hero video from filling its section.
  const positioned = /(?:^|\s)(?:absolute|fixed|sticky|relative)(?:\s|$)/.test(className)

  return (
    <div ref={holder} className={`${positioned ? '' : 'relative'} overflow-hidden ${className}`}>
      {fallback}
      {load && (
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={src}
          poster={poster}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
      )}
      {!load && poster && (
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </div>
  )
}
