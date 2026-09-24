import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, RotateCcw, ShieldCheck, Truck } from 'lucide-react'
import { api } from '../api/client'
import { useAsync } from '../lib/useAsync'
import { useRegion } from '../regions/RegionContext'
import { useCart } from '../context/CartContext'
import { freeShippingThreshold } from '../lib/pricing'
import { formatMoney, formatThreshold } from '../lib/money'
import { formatDeliveryEstimate } from '../lib/delivery'
import Media from '../components/ui/Media'
import Price from '../components/ui/Price'
import ProductCard from '../components/ProductCard'
import RecentlyViewed from '../components/RecentlyViewed'
import { ErrorState, Pill, QuantityStepper, Stars } from '../components/ui/Atoms'
import { useToast } from '../components/ui/Toast'
import { RevealGroup } from '../components/ui/Reveal'
import { Seo, absoluteUrl, breadcrumbSchema, graph } from '../lib/seo'
import { useRecentlyViewed } from '../lib/useRecentlyViewed'
import { minorPerMajor } from '../lib/money'
import type { Product, Variant } from '../types'

export default function ProductDetail() {
  const { slug = '' } = useParams()
  const { region, config, href } = useRegion()

  const state = useAsync(() => api.getProduct(slug), [slug])
  const related = useAsync(() => api.getRelated(slug, region), [slug, region])

  if (state.loading) return <DetailSkeleton />
  if (state.error || !state.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24">
        <ErrorState message={state.error ?? 'Product not found.'} onRetry={state.reload} />
        <div className="mt-6 text-center">
          <Link to={href('/shop')} className="font-body text-[14px] uppercase text-accent underline underline-offset-4">
            Back to the shop
          </Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <ProductBody key={state.data.id} product={state.data} />
      {related.data && related.data.length > 0 && (
        <section className="mx-auto max-w-[1600px] px-4 pb-20 sm:px-6 lg:px-10">
          <h2 className="mb-8 font-grotesk text-[24px] uppercase text-ink sm:text-[32px]">
            Goes with it
          </h2>
          <RevealGroup className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {related.data.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </RevealGroup>
        </section>
      )}
      <RecentlyViewed excludeId={state.data.id} />
    </>
  )
}

function ProductBody({ product }: { product: Product }) {
  const { region, config, href } = useRegion()
  const { add, quantityOf, open: openCart } = useCart()
  const toast = useToast()

  const colors = useMemo(() => {
    const seen = new Map<string, string | undefined>()
    for (const v of product.variants) {
      if (v.options.color && !seen.has(v.options.color)) seen.set(v.options.color, v.options.colorHex)
    }
    return [...seen.entries()].map(([name, hex]) => ({ name, hex }))
  }, [product])

  const sizes = useMemo(() => {
    const seen: string[] = []
    for (const v of product.variants) {
      if (v.options.size && !seen.includes(v.options.size)) seen.push(v.options.size)
    }
    return seen
  }, [product])

  // Start on the first variant that is actually buyable here.
  const firstAvailable =
    product.variants.find((v) => v.stock[region] > 0) ?? product.variants[0]

  const [color, setColor] = useState<string | undefined>(firstAvailable.options.color)
  const [size, setSize] = useState<string | undefined>(firstAvailable.options.size)
  const [quantity, setQuantity] = useState(1)
  const [mediaIndex, setMediaIndex] = useState(0)
  const [justAdded, setJustAdded] = useState(false)
  const [showStickyBar, setShowStickyBar] = useState(false)
  const buyRowRef = useRef<HTMLDivElement>(null)

  useRecentlyViewed(product.id)

  const selected: Variant | undefined = useMemo(() => {
    return product.variants.find(
      (v) =>
        (colors.length === 0 || v.options.color === color) &&
        (sizes.length === 0 || v.options.size === size),
    )
  }, [product, color, size, colors.length, sizes.length])

  const stock = selected ? selected.stock[region] : 0
  const inCart = selected ? quantityOf(selected.id) : 0
  const maxAddable = Math.max(0, Math.min(stock - inCart, 10 - inCart))

  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), Math.max(1, maxAddable)))
  }, [maxAddable])

  useEffect(() => {
    if (!justAdded) return
    const timer = setTimeout(() => setJustAdded(false), 2200)
    return () => clearTimeout(timer)
  }, [justAdded])

  // On a phone the buy button scrolls away as soon as you start reading
  // the description, so a compact bar takes over once it leaves the top
  // of the screen.
  useEffect(() => {
    const node = buyRowRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyBar(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  /** Is this colour available in any size that is in stock? */
  function colorAvailable(name: string): boolean {
    return product.variants.some((v) => v.options.color === name && v.stock[region] > 0)
  }

  /** Is this size in stock for the currently chosen colour? */
  function sizeAvailable(value: string): boolean {
    return product.variants.some(
      (v) =>
        v.options.size === value &&
        (colors.length === 0 || v.options.color === color) &&
        v.stock[region] > 0,
    )
  }

  const threshold = freeShippingThreshold(config)
  // Must follow the product's origin. Reading config.shipping[0]
  // unconditionally promised local delivery on an imported product — the
  // page would say three days while the checkout charged for three
  // weeks.
  const deliveryTiers =
    product?.origin === 'import' && config.importShipping
      ? config.importShipping.tiers
      : config.shipping
  const cheapestShipping = deliveryTiers[0]

  function handleAdd() {
    if (!selected || maxAddable <= 0) return
    add(product, selected, quantity)
    setJustAdded(true)
    toast.success(
      quantity > 1 ? quantity + ' added to your cart' : 'Added to your cart',
      product.name + ' - ' + selected.label,
      { label: 'View cart', onClick: openCart },
    )
  }

  // Structured-data prices are in major units (49.00), not the minor
  // units the app calculates in.
  const unit = minorPerMajor(config)
  const allPrices = product.variants.map((v) => v.price[region] / unit)
  const totalStock = product.variants.reduce((n, v) => n + v.stock[region], 0)

  const schema = graph(
    breadcrumbSchema(config, [
      { name: config.storeName, path: '/' },
      { name: 'Shop', path: '/shop' },
      { name: product.category, path: '/shop/' + product.category },
      { name: product.name, path: '/product/' + product.slug },
    ]),
    {
      '@type': 'Product',
      name: product.name,
      description: product.description,
      category: product.category,
      brand: { '@type': 'Brand', name: 'Orbis Store' },
      sku: product.variants[0].sku,
      // Makes the listing eligible for star ratings in search results.
      ...(product.rating
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: product.rating.average,
              reviewCount: product.rating.count,
              bestRating: 5,
              worstRating: 1,
            },
          }
        : {}),
      url: absoluteUrl(config.code, '/product/' + product.slug),
      offers: {
        '@type': 'AggregateOffer',
        offerCount: product.variants.length,
        lowPrice: Math.min(...allPrices).toFixed(config.currency.decimals),
        highPrice: Math.max(...allPrices).toFixed(config.currency.decimals),
        priceCurrency: config.currency.code,
        availability:
          totalStock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        eligibleRegion: { '@type': 'Country', name: config.country },
        seller: { '@type': 'Organization', name: config.entity.name },
        hasMerchantReturnPolicy: {
          '@type': 'MerchantReturnPolicy',
          applicableCountry: config.countryCode,
          returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
          merchantReturnDays: config.policy.returnsDays,
          returnMethod: 'https://schema.org/ReturnByMail',
        },
      },
    },
  )

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-10 pb-28 sm:px-6 lg:px-10 lg:pb-10">
      <Seo
        title={product.name + ' - ' + product.tagline}
        description={
          product.description.slice(0, 150) +
          ' Delivered across ' +
          config.country +
          ', priced in ' +
          config.currency.code +
          '.'
        }
        path={'/product/' + product.slug}
        type="product"
        jsonLd={schema}
      />
      <nav className="mb-8 flex flex-wrap items-center gap-2 font-body text-[13px] uppercase text-muted">
        <Link to={href('/')} className="hover:text-ink">
          {config.storeName}
        </Link>
        <span>/</span>
        <Link to={href(`/shop/${product.category}`)} className="hover:text-ink">
          {product.category}
        </Link>
        <span>/</span>
        <span className="text-ink/80">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        {/* ------------------------------------------------ gallery */}
        <div>
          <div className="aspect-square w-full overflow-hidden rounded-[26px] bg-surface">
            <Media item={product.media[mediaIndex]} />
          </div>
          {product.media.length > 1 && (
            <div className="mt-3 flex gap-3">
              {product.media.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setMediaIndex(i)}
                  aria-label={`View image ${i + 1}`}
                  className={`h-20 w-20 overflow-hidden rounded-[14px] border transition-colors ${
                    i === mediaIndex ? 'border-accent' : 'border-ink/15 hover:border-ink/40'
                  }`}
                >
                  <Media item={item} autoPlay={false} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* -------------------------------------------------- buybox */}
        <div className="lg:pt-4">
          {product.badges && (
            <div className="mb-4 flex flex-wrap gap-2">
              {product.badges.map((b) => (
                <Pill key={b} tone="neon">
                  {b}
                </Pill>
              ))}
            </div>
          )}

          <h1 className="font-grotesk text-[30px] uppercase leading-tight text-ink sm:text-[40px]">
            {product.name}
          </h1>
          <p className="mt-2 font-body text-[14px] uppercase text-muted">{product.tagline}</p>

          {product.rating && (
            <div className="mt-3 flex items-center gap-2">
              {/* Stars already prints the average — this only adds the
                  sample size, which is the part that builds trust. */}
              <Stars rating={product.rating} size={14} showCount={false} />
              <span className="font-body text-[13px] text-muted">
                · {product.rating.count} reviews
              </span>
            </div>
          )}

          <div className="mt-6 flex items-baseline gap-3">
            <Price
              amount={selected ? selected.price[region] : product.variants[0].price[region]}
              className="font-grotesk text-[30px] text-accent"
              compact={false}
            />
            <span className="font-body text-[13px] uppercase text-muted">{config.taxNote}</span>
          </div>

          <p className="mt-6 font-body text-[15px] leading-relaxed text-ink/80">{product.description}</p>

          {product.highlights.length > 0 && (
            <ul className="mt-5 space-y-2">
              {product.highlights.map((point) => (
                <li key={point} className="flex gap-2.5 font-body text-[14px] leading-relaxed text-ink/80">
                  <Check size={14} className="mt-0.5 flex-none text-accent" strokeWidth={2.5} />
                  {point}
                </li>
              ))}
            </ul>
          )}

          {/* colour */}
          {colors.length > 0 && (
            <div className="mt-8">
              <div className="mb-3 font-body text-[13px] uppercase tracking-wide text-muted">
                Finish{color ? <span className="text-ink"> · {color}</span> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {colors.map((c) => {
                  const available = colorAvailable(c.name)
                  const isActive = c.name === color
                  return (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setColor(c.name)}
                      disabled={!available}
                      className={`flex items-center gap-2 rounded-full border px-3 py-2 font-body text-[13px] uppercase transition-colors ${
                        isActive ? 'border-accent text-ink' : 'border-ink/15 text-muted hover:border-ink/40'
                      } ${!available ? 'cursor-not-allowed opacity-35 line-through' : ''}`}
                    >
                      {c.hex && (
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-ink/25"
                          style={{ backgroundColor: c.hex }}
                        />
                      )}
                      {c.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* size */}
          {sizes.length > 0 && (
            <div className="mt-6">
              <div className="mb-3 font-body text-[13px] uppercase tracking-wide text-muted">
                Size{size ? <span className="text-ink"> · {size}</span> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {sizes.map((sz) => {
                  const available = sizeAvailable(sz)
                  const isActive = sz === size
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setSize(sz)}
                      disabled={!available}
                      className={`min-w-[54px] rounded-full border px-4 py-2 font-body text-[13px] uppercase transition-colors ${
                        isActive ? 'border-accent bg-accent/10 text-accent' : 'border-ink/15 text-muted hover:border-ink/40'
                      } ${!available ? 'cursor-not-allowed opacity-35 line-through' : ''}`}
                    >
                      {sz}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* stock */}
          <div className="mt-6 font-body text-[13px] uppercase">
            {stock === 0 ? (
              <span className="text-amber-300">Sold out in {config.country}</span>
            ) : stock <= 5 ? (
              <span className="text-amber-300">Only {stock} left in the {config.country} warehouse</span>
            ) : (
              <span className="text-accent">In stock · ships from {config.country}</span>
            )}
            {inCart > 0 && <span className="ml-2 text-muted">({inCart} already in your cart)</span>}
          </div>

          {/* add to cart */}
          <div ref={buyRowRef} className="mt-5 flex flex-wrap items-center gap-3">
            <QuantityStepper
              value={quantity}
              max={Math.max(1, maxAddable)}
              onChange={setQuantity}
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={maxAddable <= 0}
              className={`press flex flex-1 items-center justify-center gap-2 rounded-full bg-neon px-8 py-3.5 font-grotesk text-[15px] uppercase text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 ${
                justAdded ? 'animate-pulse-ring' : ''
              }`}
            >
              {justAdded ? (
                <>
                  <Check size={16} strokeWidth={2.5} /> Added
                </>
              ) : maxAddable <= 0 ? (
                stock === 0 ? 'Sold out' : 'Cart limit reached'
              ) : (
                'Add to cart'
              )}
            </button>
          </div>

          {stock === 0 && (
            <p className="mt-3 font-body text-[13px] leading-relaxed text-muted">
              This option is out of stock here. It may still be available in one of our other
              stores — use the store switcher in the header.
            </p>
          )}

          {/* An imported product quotes different delivery entirely, so
              the promise on this page has to come from the same table
              the checkout will charge from — otherwise the page says
              three days and the basket says three weeks. */}
          {product.origin === 'import' && config.importShipping && (
            <div className="mt-8 rounded-[18px] border border-accent/25 bg-accent/[0.05] p-5">
              <div className="font-grotesk text-[14px] uppercase text-ink">
                Ships from {config.importShipping.from}
              </div>
              <ul className="mt-3 space-y-1.5">
                {config.importShipping.tiers.map((tier) => (
                  <li key={tier.id} className="font-body text-[13px] leading-relaxed text-muted">
                    <span className="text-ink">{tier.label}</span> · {tier.eta} ·{' '}
                    {formatMoney(tier.amount, config)}
                    {tier.freeOver !== undefined
                      ? `, free over ${formatMoney(tier.freeOver, config)}`
                      : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-3 font-body text-[13px] leading-relaxed text-muted">
                {config.importShipping.note}
              </p>
            </div>
          )}

          {/* delivery, per region */}
          <div className="mt-8 space-y-3 rounded-[18px] border border-ink/10 bg-ink/[0.02] p-5">
            <Line
              icon={Truck}
              title={
                stock > 0
                  ? `Order today, get it by ${formatDeliveryEstimate(config, cheapestShipping)}`
                  : `${cheapestShipping.label} — ${cheapestShipping.eta}`
              }
              body={
                threshold !== null
                  ? `${cheapestShipping.label}, free on orders over ${formatThreshold(threshold, config)}. ${config.policy.dutiesNote}`
                  : `${cheapestShipping.label}. ${config.policy.dutiesNote}`
              }
            />
            <Line
              icon={RotateCcw}
              title={`${config.policy.returnsDays}-day returns`}
              body="Unused and in the original packaging. We arrange the collection."
            />
            <Line
              icon={ShieldCheck}
              title="Ways to pay"
              body={`Pay with ${config.paymentMethods.slice(0, 3).map((m) => m.label).join(', ')}.`}
            />
          </div>

          {/* specs */}
          <dl className="mt-8 divide-y divide-ink/10 border-t border-ink/10">
            {product.specs.map((spec) => (
              <div key={spec.label} className="flex justify-between gap-6 py-3">
                <dt className="font-body text-[13px] uppercase text-muted">{spec.label}</dt>
                <dd className="text-right font-body text-[14px] text-ink/80">{spec.value}</dd>
              </div>
            ))}
            {selected && (
              <div className="flex justify-between gap-6 py-3">
                <dt className="font-body text-[13px] uppercase text-muted">SKU</dt>
                <dd className="text-right font-body text-[14px] text-ink/80">{selected.sku}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Sticky buy bar - phones only, once the real button has scrolled off */}
      <div
        className={`fixed inset-x-0 bottom-0 z-[70] border-t border-ink/10 bg-surface/95 px-4 py-3 backdrop-blur-md transition-transform duration-300 ease-arrive lg:hidden ${
          showStickyBar ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-grotesk text-[13px] uppercase text-ink">{product.name}</div>
            <Price
              amount={selected ? selected.price[region] : product.variants[0].price[region]}
              className="font-body text-[15px] text-accent"
              compact={false}
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={maxAddable <= 0}
            className="press flex-none rounded-full bg-neon px-6 py-3 font-grotesk text-[14px] uppercase text-ink disabled:opacity-30"
          >
            {maxAddable <= 0 ? 'Sold out' : 'Add to cart'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Line({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Truck
  title: string
  body: string
}) {
  return (
    <div className="flex gap-3">
      <Icon size={15} className="mt-0.5 flex-none text-accent" strokeWidth={1.7} />
      <div>
        <div className="font-body text-[13px] uppercase text-ink">{title}</div>
        <p className="mt-0.5 font-body text-[13px] leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] animate-pulse px-4 py-16 sm:px-6 lg:px-10">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        <div className="aspect-square w-full rounded-[26px] bg-ink/5" />
        <div className="space-y-4 pt-6">
          <div className="h-8 w-2/3 rounded bg-ink/10" />
          <div className="h-4 w-1/3 rounded bg-ink/5" />
          <div className="h-10 w-1/4 rounded bg-ink/10" />
          <div className="h-24 w-full rounded bg-ink/5" />
          <div className="h-12 w-full rounded-full bg-ink/10" />
        </div>
      </div>
    </div>
  )
}
