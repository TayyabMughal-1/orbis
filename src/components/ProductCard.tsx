import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Plus } from 'lucide-react'
import { useRegion } from '../regions/RegionContext'
import { useCart } from '../context/CartContext'
import { useToast } from './ui/Toast'
import Media from './ui/Media'
import Price from './ui/Price'
import { Pill, Stars } from './ui/Atoms'
import type { Product } from '../types'

export default function ProductCard({ product }: { product: Product }) {
  const { region, href, config } = useRegion()
  const { add, open: openCart } = useCart()
  const toast = useToast()

  const prices = product.variants.map((v) => v.price[region])
  const from = Math.min(...prices)
  const varies = Math.max(...prices) !== from

  const totalStock = product.variants.reduce((n, v) => n + v.stock[region], 0)
  const soldOut = totalStock === 0
  const low = !soldOut && totalStock <= 5

  // Anything with one variant can go straight into the cart from the
  // grid; anything with a size or finish to choose needs the product
  // page, so the button becomes a plain link through to it.
  const onlyVariant = product.variants.length === 1 ? product.variants[0] : null
  const canQuickAdd = Boolean(onlyVariant && onlyVariant.stock[region] > 0)

  function quickAdd(event: MouseEvent) {
    // The card itself is a link — do not follow it on a quick add.
    event.preventDefault()
    event.stopPropagation()
    if (!onlyVariant) return
    add(product, onlyVariant, 1)
    toast.success('Added to your cart', product.name, {
      label: 'View cart',
      onClick: openCart,
    })
  }

  return (
    <Link
      to={href(`/product/${product.slug}`)}
      className="group flex h-full flex-col rounded-[24px] border border-ink/[0.07] bg-background p-4 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-ink/[0.12] hover:shadow-card-hover"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-[18px] bg-surface">
        <Media item={product.media[0]} className="transition-transform duration-700 group-hover:scale-[1.04]" />

        {/* Imported goods take a different route with a different price
            and a much longer wait, so that belongs on the card rather
            than as a surprise at checkout. */}
        {product.origin === 'import' && config.importShipping && (
          <div className="absolute right-3 top-3 rounded-full bg-ink/85 px-2.5 py-1 font-body text-[9px] font-medium uppercase tracking-wide text-background backdrop-blur">
            From {config.importShipping.from}
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {soldOut ? (
            <Pill tone="warn">Sold out</Pill>
          ) : (
            <>
              {low && <Pill tone="warn">Only {totalStock} left</Pill>}
              {product.badges?.slice(0, 1).map((badge) => (
                <Pill key={badge}>{badge}</Pill>
              ))}
            </>
          )}
        </div>

        {/* Quick add, or a hint that there is a choice to make */}
        {!soldOut && (
          <span
            className="absolute bottom-3 right-3 translate-y-2 opacity-0 transition-all duration-300 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
          >
            {canQuickAdd ? (
              <button
                type="button"
                onClick={quickAdd}
                aria-label={`Add ${product.name} to cart`}
                className="press flex h-10 w-10 items-center justify-center rounded-full bg-neon text-ink shadow-lg shadow-accent/25"
              >
                <Plus size={18} strokeWidth={2.4} />
              </button>
            ) : (
              <span className="flex h-10 items-center gap-1.5 rounded-full bg-neon px-4 font-grotesk text-[11px] uppercase text-ink shadow-lg shadow-accent/25">
                Choose options
                <ArrowUpRight size={14} strokeWidth={2.4} />
              </span>
            )}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-1 flex-col">
        <h3 className="font-grotesk text-[14px] uppercase leading-tight text-ink transition-colors group-hover:text-accent">
          {product.name}
        </h3>
        {product.rating && <Stars rating={product.rating} className="mt-1.5" />}
        <p className="mt-1.5 font-body text-[11px] leading-relaxed text-muted">{product.tagline}</p>

        <div className="mt-4 flex items-end justify-between">
          <div>
            {varies && <span className="mr-1 font-body text-[10px] uppercase text-muted">From</span>}
            <Price amount={from} className="font-body text-[15px] text-accent" />
          </div>
          {config.taxIncludedInPrice && (
            <span className="font-body text-[9px] uppercase text-muted">Incl. {config.taxLabel}</span>
          )}
        </div>
      </div>
    </Link>
  )
}
