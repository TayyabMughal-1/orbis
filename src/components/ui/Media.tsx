import ProductVisual from './ProductVisual'
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

  if (item.kind === 'video') {
    return (
      <video
        className={`h-full w-full object-cover ${className}`}
        src={item.src}
        autoPlay={autoPlay}
        loop
        muted
        playsInline
        preload="metadata"
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
