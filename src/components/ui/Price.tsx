import { formatMoney } from '../../lib/money'
import { useRegion } from '../../regions/RegionContext'

/**
 * The only component that renders a price. Every figure on the site goes
 * through here, so a storefront can never accidentally show one market's
 * number with another market's symbol.
 */
export default function Price({
  amount,
  compareAt,
  className = '',
  compact = true,
}: {
  amount: number
  compareAt?: number
  className?: string
  compact?: boolean
}) {
  const { config } = useRegion()

  return (
    <span className={className}>
      <span>{formatMoney(amount, config, compact)}</span>
      {compareAt !== undefined && compareAt > amount && (
        <span className="ml-2 text-cream/40 line-through">{formatMoney(compareAt, config, compact)}</span>
      )}
    </span>
  )
}

/** Bare string form, for places that need text rather than an element. */
export function usePriceFormatter() {
  const { config } = useRegion()
  return (amount: number, compact = true) => formatMoney(amount, config, compact)
}
