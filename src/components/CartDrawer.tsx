import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useRegion } from '../regions/RegionContext'
import { freeShippingThreshold } from '../lib/pricing'
import { formatMoney } from '../lib/money'
import Media from './ui/Media'
import Price from './ui/Price'
import { QuantityStepper } from './ui/Atoms'

export default function CartDrawer() {
  const { resolved, count, subtotal, isOpen, close, setQuantity, remove, lastAdded } = useCart()
  const { config, href } = useRegion()

  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close()
        return
      }
      // Keep Tab inside the drawer while it is open, so keyboard users
      // are not silently tabbing through the page behind it.
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    // Freeze the page behind the drawer rather than letting it scroll.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen, close])

  const threshold = freeShippingThreshold(config)
  const remaining = threshold !== null ? Math.max(0, threshold - subtotal) : 0
  const progress = threshold !== null ? Math.min(100, (subtotal / threshold) * 100) : 0

  return (
    <>
      <div
        onClick={close}
        aria-hidden="true"
        className={`fixed inset-0 z-[85] bg-black/60 backdrop-blur-[2px] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        aria-hidden={!isOpen}
        className={`fixed right-0 top-0 z-[90] flex h-full w-full max-w-[430px] flex-col border-l border-white/10 bg-[#040a24] transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <span className="font-grotesk text-[15px] uppercase text-cream">Your cart</span>
            <span className="ml-2 font-mono text-[11px] text-cream/45">
              {count} item{count === 1 ? '' : 's'} · {config.currency.code}
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close cart"
            className="press flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-cream hover:border-white/35"
          >
            <X size={15} />
          </button>
        </div>

        {threshold !== null && count > 0 && (
          <div className="border-b border-white/10 px-5 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wide text-cream/60">
              {remaining > 0 ? (
                <>
                  {formatMoney(remaining, config, true)} away from free delivery
                </>
              ) : (
                <span className="text-neon">Free delivery unlocked</span>
              )}
            </p>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-neon transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {resolved.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="font-mono text-[12px] uppercase leading-relaxed text-cream/50">
                Your cart is empty.
              </p>
              <Link
                to={href('/shop')}
                onClick={close}
                className="mt-5 rounded-full bg-neon px-6 py-2.5 font-grotesk text-[12px] uppercase text-background"
              >
                Start shopping
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {resolved.map(({ line, product, variant, unitPrice, lineTotal, stock }, i) => (
                <li
                  key={variant.id}
                  style={{ animationDelay: `${Math.min(i * 45, 270)}ms` }}
                  className={`animate-fade-up flex gap-3 rounded-[16px] p-2 transition-colors ${
                    lastAdded === variant.id ? 'bg-neon/[0.07] ring-1 ring-neon/30' : ''
                  }`}
                >
                  <Link
                    to={href(`/product/${product.slug}`)}
                    onClick={close}
                    className="h-[76px] w-[76px] flex-none overflow-hidden rounded-[12px] bg-[#03081c]"
                  >
                    <Media item={product.media[0]} autoPlay={false} />
                  </Link>

                  <div className="min-w-0 flex-1">
                    <Link
                      to={href(`/product/${product.slug}`)}
                      onClick={close}
                      className="block truncate font-grotesk text-[12px] uppercase text-cream hover:text-neon"
                    >
                      {product.name}
                    </Link>
                    <div className="mt-0.5 font-mono text-[10px] uppercase text-cream/45">
                      {variant.label}
                    </div>
                    {line.quantity >= stock && stock > 0 && (
                      <div className="mt-1 font-mono text-[10px] uppercase text-amber-300/80">
                        Max stock reached
                      </div>
                    )}

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <QuantityStepper
                        value={line.quantity}
                        max={Math.max(1, Math.min(stock, 10))}
                        onChange={(next) => setQuantity(variant.id, next)}
                        size="sm"
                      />
                      <button
                        type="button"
                        onClick={() => remove(variant.id)}
                        className="font-mono text-[10px] uppercase text-cream/40 underline underline-offset-2 hover:text-cream"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="flex-none text-right">
                    <Price amount={lineTotal} className="font-mono text-[13px] text-neon" />
                    {line.quantity > 1 && (
                      <div className="mt-1 font-mono text-[10px] text-cream/40">
                        <Price amount={unitPrice} /> ea
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {resolved.length > 0 && (
          <div className="border-t border-white/10 px-5 py-4">
            <div className="flex items-center justify-between font-grotesk text-[14px] uppercase text-cream">
              <span>Subtotal</span>
              <Price amount={subtotal} className="text-neon" compact={false} />
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase text-cream/40">
              {config.taxIncludedInPrice ? config.taxNote : config.taxNote} · Delivery at checkout
            </p>

            <Link
              to={href('/checkout')}
              onClick={close}
              className="press mt-4 block rounded-full bg-neon py-3 text-center font-grotesk text-[13px] uppercase text-background transition-opacity hover:opacity-90"
            >
              Checkout
            </Link>
            <Link
              to={href('/cart')}
              onClick={close}
              className="mt-2 block py-2 text-center font-mono text-[11px] uppercase text-cream/55 hover:text-cream"
            >
              View full cart
            </Link>
          </div>
        )}
      </aside>
    </>
  )
}
