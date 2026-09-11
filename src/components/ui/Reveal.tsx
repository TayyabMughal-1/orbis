import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'

// ---------------------------------------------------------------------
// Scroll reveal.
//
// One IntersectionObserver per element, disconnected the moment it has
// fired — an element animates in once and is then left alone, so a long
// catalogue page does not keep dozens of observers alive while scrolling.
//
// Anything already on screen at mount reveals immediately, and visitors
// who prefer reduced motion skip the whole mechanism (index.css also
// forces .reveal visible, so content can never be trapped invisible).
// ---------------------------------------------------------------------

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function Reveal({
  children,
  as: Tag = 'div',
  delay = 0,
  className = '',
}: {
  children: ReactNode
  as?: ElementType
  /** Stagger, in milliseconds. */
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(() => prefersReducedMotion())

  useEffect(() => {
    if (visible) return
    const node = ref.current
    if (!node) return

    // No observer support (very old browsers): show it rather than hide it.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  return (
    <Tag
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}

/** Reveals children one after another — for grids and lists. */
export function RevealGroup({
  children,
  className = '',
  step = 70,
  as,
}: {
  children: ReactNode[]
  className?: string
  step?: number
  as?: ElementType
}) {
  return (
    <div className={className}>
      {children.map((child, i) => (
        // Cap the stagger so the last card in a long grid is not left
        // waiting seconds for its turn.
        <Reveal key={i} as={as} delay={Math.min(i * step, 420)}>
          {child}
        </Reveal>
      ))}
    </div>
  )
}
