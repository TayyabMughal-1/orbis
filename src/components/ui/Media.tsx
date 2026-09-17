import ProductVisual from './ProductVisual'
import LazyVideo from './LazyVideo'
import type { MediaItem } from '../../types'

/**
 * Renders whichever media a product carries. Videos autoplay muted and
 * inline so they behave like moving stills; drawn renders cost nothing
 * to load. Callers control the frame — this always fills it.
 */
export default function Media({
  item,
  className = '',
  autoPlay = true,
}: {
  item: MediaItem | undefined
  className?: string
  autoPlay?: boolean
}) {
  if (!item) {
    return <div className={`bg-ink/5 ${className}`} />
  }

  if (item.kind === 'image') {
    return (
      <img
        src={item.src}
        alt={item.alt ?? ''}
        loading="lazy"
        decoding="async"
        className={`h-full w-full object-cover ${className}`}
      />
    )
  }

  if (item.kind === 'video') {
    // Off-screen cards cost nothing until they scroll in. A grid of
    // twenty products would otherwise start twenty downloads at once.
    return (
      <LazyVideo
        src={item.src}
        className={`h-full w-full ${className}`}
        fallback={<div className="absolute inset-0 bg-ink/5" />}
      />
    )
  }

  return (
    <ProductVisual
      shape={item.shape}
      hue={item.hue}
      accent={item.accent}
      className={`h-full w-full object-cover ${className}`}
    />
  )
}
