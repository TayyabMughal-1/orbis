import { Link } from 'react-router-dom'
import { ArrowRight, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useAsync } from '../lib/useAsync'
import { useCart } from '../context/CartContext'
import { useRegion } from '../regions/RegionContext'
import { usePromo } from '../lib/usePromo'
import Media from '../components/ui/Media'
import Price from '../components/ui/Price'
import { EmptyState, QuantityStepper } from '../components/ui/Atoms'
import { PromoField, TotalsRows } from '../components/OrderSummary'
import { Seo } from '../lib/seo'

export default function CartPage() {
  const { resolved, lines, subtotal, count, setQuantity, remove, clear } = useCart()
  const { region, config, href } = useRegion()
  const promo = usePromo(subtotal)

  // The cart previews the cheapest delivery option; checkout lets the
  // customer choose and recalculates. An empty cart has nothing to
  // quote, and asking anyway is a guaranteed 400.
  const quote = useAsync(
    () => api.quote({ region, lines, promoCode: promo.code }),
    [region, JSON.stringify(lines), promo.code],
    { enabled: lines.length > 0 },
  )

  if (resolved.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
        <Seo title="Your cart" description="Review the items in your Orbis Store cart." path="/cart" noindex />
        <h1 className="mb-8 text-center font-grotesk text-[34px] uppercase text-cream">Your cart</h1>
        <EmptyState
          title="Nothing here yet"
          body={`Your ${config.country} cart is empty. Anything you add is priced in ${config.currency.code} and ships from our local warehouse.`}
          action={
            <Link
              to={href('/shop')}
              className="inline-flex items-center gap-2 rounded-full bg-neon px-7 py-3 font-grotesk text-[12px] uppercase text-background"
            >
              Browse the collection <ArrowRight size={15} />
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:px-10">
      <Seo
        title="Your cart"
        description={'Review your cart and check out in ' + config.currency.code + '.'}
        path="/cart"
        noindex
      />
      <div className="mb-10 flex items-end justify-between">
        <h1 className="font-grotesk text-[34px] uppercase leading-none text-cream sm:text-[44px]">
          Your cart
        </h1>
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1.5 font-mono text-[11px] uppercase text-cream/40 hover:text-cream"
        >
          <Trash2 size={13} /> Empty cart
        </button>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.6fr_1fr] lg:gap-14">
        {/* lines */}
        <div>
          <ul className="divide-y divide-white/10 border-y border-white/10">
            {resolved.map(({ line, product, variant, unitPrice, lineTotal, stock }) => (
              <li key={variant.id} className="flex gap-4 py-5">
                <Link
                  to={href(`/product/${product.slug}`)}
                  className="h-[104px] w-[104px] flex-none overflow-hidden rounded-[16px] bg-[#03081c] sm:h-[128px] sm:w-[128px]"
                >
                  <Media item={product.media[0]} autoPlay={false} />
                </Link>

                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    to={href(`/product/${product.slug}`)}
                    className="font-grotesk text-[14px] uppercase text-cream hover:text-neon"
                  >
                    {product.name}
                  </Link>
                  <div className="mt-1 font-mono text-[11px] uppercase text-cream/45">
                    {variant.label} · {variant.sku}
                  </div>
                  {stock <= 5 && (
                    <div className="mt-1 font-mono text-[10px] uppercase text-amber-300/80">
                      Only {stock} left
                    </div>
                  )}

                  <div className="mt-auto flex flex-wrap items-center gap-4 pt-4">
                    <QuantityStepper
                      value={line.quantity}
                      max={Math.max(1, Math.min(stock, 10))}
                      onChange={(next) => setQuantity(variant.id, next)}
                    />
                    <button
                      type="button"
                      onClick={() => remove(variant.id)}
                      className="font-mono text-[11px] uppercase text-cream/40 underline underline-offset-2 hover:text-cream"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="flex-none text-right">
                  <Price amount={lineTotal} className="font-mono text-[15px] text-neon" compact={false} />
                  {line.quantity > 1 && (
                    <div className="mt-1 font-mono text-[10px] text-cream/40">
                      <Price amount={unitPrice} compact={false} /> each
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <Link
            to={href('/shop')}
            className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase text-cream/55 hover:text-cream"
          >
            ← Continue shopping
          </Link>
        </div>

        {/* summary */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-[20px] border border-white/10 bg-white/[0.02] p-6">
            <h2 className="mb-5 font-grotesk text-[14px] uppercase text-cream">
              Summary
              <span className="ml-2 font-mono text-[11px] normal-case text-cream/40">
                {count} item{count === 1 ? '' : 's'}
              </span>
            </h2>

            <div className="mb-5">
              <PromoField
                code={promo.code}
                appliedLabel={promo.label}
                error={promo.error}
                onApply={promo.apply}
                onClear={promo.clear}
                busy={promo.busy}
              />
            </div>

            {quote.data ? (
              <TotalsRows totals={quote.data.totals} shippingPending />
            ) : (
              <div className="h-32 animate-pulse rounded bg-white/5" />
            )}

            <Link
              to={href('/checkout')}
              className="press mt-6 flex items-center justify-center gap-2 rounded-full bg-neon py-3.5 font-grotesk text-[13px] uppercase text-background transition-opacity hover:opacity-90"
            >
              Checkout <ArrowRight size={15} />
            </Link>

            <p className="mt-4 font-mono text-[10px] leading-relaxed text-cream/40">
              {config.taxNote}. Delivery is chosen at checkout — {config.shipping.length} options for{' '}
              {config.country}. Pay by{' '}
              {config.paymentMethods
                .slice(0, 3)
                .map((m) => m.label.toLowerCase())
                .join(', ')}
              .
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
