import { taxRateFor, type RegionConfig, type ShippingTier } from '../regions/config.js'
import type { OrderTotals, ShippingQuote } from '../types.js'
import { applyRate, taxWithin } from './money.js'

// ---------------------------------------------------------------------
// One place where an order's numbers are decided. The checkout screen
// and the order record both call this, so what the customer is quoted
// and what gets stored can never drift apart.
// ---------------------------------------------------------------------

/**
 * Delivery options for a basket.
 *
 * A basket holding any imported line quotes the region's import tiers
 * instead of its local ones — not both. Two shipments, two charges and
 * two arrival dates is a fulfilment model this shop does not have, so
 * the whole order travels the slower way and the checkout says so.
 */
export function shippingQuotesFor(
  config: RegionConfig,
  goodsSubtotal: number,
  hasImported = false,
): ShippingQuote[] {
  const tiers = hasImported && config.importShipping ? config.importShipping.tiers : config.shipping
  return tiers.map((tier: ShippingTier) => {
    const free = tier.freeOver !== undefined && goodsSubtotal >= tier.freeOver
    return {
      id: tier.id,
      label: tier.label,
      eta: tier.eta,
      amount: free ? 0 : tier.amount,
      free,
    }
  })
}

/** Cheapest tier that offers free delivery, for the promo banner. */
export function freeShippingThreshold(config: RegionConfig): number | null {
  // The banner advertises local delivery, which is what most of the
  // catalogue is; the import threshold is shown on the products it
  // applies to instead.
  const thresholds = config.shipping
    .map((t) => t.freeOver)
    .filter((v): v is number => typeof v === 'number')
  return thresholds.length ? Math.min(...thresholds) : null
}

export type TotalsInput = {
  config: RegionConfig
  /** Sum of line totals, before any discount. */
  subtotal: number
  shipping: number
  /** Percentage off the goods subtotal, 0-100. */
  discountPercent: number
  /** Payment-method handling fee, e.g. cash on delivery. */
  surcharge: number
  /** Ship-to state / emirate / province — drives the US rate. */
  subRegion?: string
}

export function computeTotals(input: TotalsInput): OrderTotals {
  const { config, subtotal, shipping, discountPercent, surcharge, subRegion } = input

  const discount = discountPercent > 0 ? applyRate(subtotal, discountPercent / 100) : 0
  const goods = Math.max(0, subtotal - discount)
  const taxable = goods + shipping + surcharge
  const rate = taxRateFor(config, subRegion)

  if (config.taxIncludedInPrice) {
    // UAE and Pakistan: the displayed price already contains the tax, so
    // the total is just the sum — we only report how much of it is tax.
    return {
      currency: config.currency.code,
      subtotal,
      discount,
      shipping,
      surcharge,
      tax: 0,
      taxIncluded: taxWithin(taxable, rate),
      taxLabel: config.taxLabel,
      taxRate: rate,
      total: taxable,
    }
  }

  // US: tax is added on top. Shipping is treated as taxable, which is
  // the majority rule across US states.
  const tax = applyRate(taxable, rate)
  return {
    currency: config.currency.code,
    subtotal,
    discount,
    shipping,
    surcharge,
    tax,
    taxIncluded: 0,
    taxLabel: config.taxLabel,
    taxRate: rate,
    total: taxable + tax,
  }
}
