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
      className="liquid-glass group flex h-full flex-col rounded-[24px] p-4 transition-all duration-300 hover:-translate-y-1 hover:bg-white/[0.08]"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-[18px] bg-[#03081c]">
        <Media item={product.media[0]} className="transition-transform duration-700 group-hover:scale-[1.04]" />

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
                className="press flex h-10 w-10 items-center justify-center rounded-full bg-neon text-background shadow-lg shadow-neon/25"
              >
                <Plus size={18} strokeWidth={2.4} />
              </button>
            ) : (
              <span className="flex h-10 items-center gap-1.5 rounded-full bg-neon px-4 font-grotesk text-[11px] uppercase text-background shadow-lg shadow-neon/25">
                Choose options
                <ArrowUpRight size={14} strokeWidth={2.4} />
              </span>
            )}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-1 flex-col">
        <h3 className="font-grotesk text-[14px] uppercase leading-tight text-cream transition-colors group-hover:text-neon">
          {product.name}
        </h3>
        {product.rating && <Stars rating={product.rating} className="mt-1.5" />}
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-cream/50">{product.tagline}</p>

        <div className="mt-4 flex items-end justify-between">
          <div>
            {varies && <span className="mr-1 font-mono text-[10px] uppercase text-cream/40">From</span>}
            <Price amount={from} className="font-mono text-[15px] text-neon" />
          </div>
          {config.taxIncludedInPrice && (
            <span className="font-mono text-[9px] uppercase text-cream/35">Incl. {config.taxLabel}</span>
          )}
        </div>
      </div>
    </Link>
  )
}
