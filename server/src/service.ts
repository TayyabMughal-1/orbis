import { badRequest, conflict } from './errors.js'
import { getPromo, getVariantsByIds } from './repo.js'
import { type RegionCode } from '../../src/regions/config.js'
import { resolveRegionConfig } from './adminRepo.js'
import { computeTotals, shippingQuotesFor } from '../../src/lib/pricing.js'
import type { CartLine, OrderLineSnapshot, OrderTotals, ShippingQuote } from '../../src/types.js'

// ---------------------------------------------------------------------
// Pricing an order.
//
// The single most important rule in the whole service: the client sends
// variant ids and quantities, and the server decides every number. A
// request that claims a price is simply ignored.
//
// The tax, shipping and discount maths are the same functions the
// storefront uses to render its own totals — imported from src/lib, not
// reimplemented — so a quote can never disagree with what was shown.
// ---------------------------------------------------------------------

export type PricedLine = OrderLineSnapshot & { variantId: string; stock: number }

export type QuoteInput = {
  region: RegionCode
  lines: CartLine[]
  shippingId?: string
  paymentMethodId?: string
  promoCode?: string | null
  /** Ship-to state / emirate / province, for regional tax rates. */
  subRegion?: string
}

export type QuoteResult = {
  lines: OrderLineSnapshot[]
  shippingOptions: ShippingQuote[]
  selectedShipping: ShippingQuote
  totals: OrderTotals
  promo: { code: string; label: string; percentOff: number } | null
  promoError: string | null
  /** Internal: carries variant ids and live stock through to checkout. */
  priced: PricedLine[]
}

export async function priceOrder(input: QuoteInput): Promise<QuoteResult> {
  // Resolved, not raw: a tax rate or delivery price changed in the
  // dashboard has to change what the customer is actually charged.
  const config = await resolveRegionConfig(input.region)

  const variantIds = input.lines.map((l) => l.variantId)
  const found = await getVariantsByIds(variantIds)

  const priced: PricedLine[] = []
  for (const line of input.lines) {
    const hit = found.get(line.variantId)
    if (!hit) {
      throw badRequest(
        'line_unavailable',
        'One of the items in your cart is no longer available. Please remove it and try again.',
      )
    }
    const unitPrice = hit.variant.price[input.region]
    priced.push({
      productId: hit.product.id,
      productName: hit.product.name,
      variantId: hit.variant.id,
      variantLabel: hit.variant.label,
      sku: hit.variant.sku,
      quantity: line.quantity,
      unitPrice,
      lineTotal: unitPrice * line.quantity,
      stock: hit.variant.stock[input.region],
    })
  }

  const subtotal = priced.reduce((sum, l) => sum + l.lineTotal, 0)

  // Promo codes are re-checked here every time, against this region and
  // this basket. A code that was valid when it was typed into the cart
  // can still fail at checkout if the basket shrank below its minimum.
  let promo: QuoteResult['promo'] = null
  let promoError: string | null = null
  if (input.promoCode) {
    const record = await getPromo(input.promoCode)
    const normalized = input.promoCode.trim().toUpperCase()
    if (!record) {
      promoError = `"${normalized}" is not a code we recognise.`
    } else if (!record.regions.includes(input.region)) {
      promoError = `"${normalized}" is not valid in the ${config.country} store.`
    } else if (subtotal < record.minSubtotal[input.region]) {
      promoError = `"${normalized}" needs a larger order to apply.`
    } else {
      promo = { code: record.code, label: record.label, percentOff: record.percentOff }
    }
  }

  const discounted = promo ? subtotal - Math.round(subtotal * (promo.percentOff / 100)) : subtotal
  // Any imported line and the whole order ships the import way. Read off
  // the products just loaded, never off the request: the client does not
  // get to choose which delivery table it is charged from.
  const hasImported = priced.some((line) => found.get(line.variantId)?.product.origin === 'import')
  const shippingOptions = shippingQuotesFor(config, discounted, hasImported)
  const selectedShipping =
    shippingOptions.find((o) => o.id === input.shippingId) ?? shippingOptions[0]

  const method = config.paymentMethods.find((m) => m.id === input.paymentMethodId)
  const surcharge = method?.surcharge ?? 0

  const totals = computeTotals({
    config,
    subtotal,
    shipping: selectedShipping.amount,
    discountPercent: promo?.percentOff ?? 0,
    surcharge,
    subRegion: input.subRegion,
  })

  return {
    lines: priced.map(({ stock: _stock, variantId: _variantId, ...line }) => line),
    shippingOptions,
    selectedShipping,
    totals,
    promo,
    promoError,
    priced,
  }
}

/**
 * A last look at stock before we try to take the money. The real
 * guarantee is the guarded UPDATE inside the order transaction — this
 * exists so the common case fails with a useful message instead of a
 * rollback.
 */
export async function assertInStock(priced: PricedLine[], region: RegionCode): Promise<void> {
  const country = (await resolveRegionConfig(region)).country
  for (const line of priced) {
    if (line.quantity > line.stock) {
      throw conflict(
        'out_of_stock',
        line.stock === 0
          ? `${line.productName} (${line.variantLabel}) has sold out in the ${country} store.`
          : `Only ${line.stock} left of ${line.productName} (${line.variantLabel}) in the ${country} store.`,
      )
    }
  }
}
