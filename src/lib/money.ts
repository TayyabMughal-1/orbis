import type { RegionConfig } from '../regions/config'

// ---------------------------------------------------------------------
// Money is always an integer in the currency's minor unit:
//   USD -> cents (2 decimals)
//   AED -> fils  (2 decimals)
//   PKR -> rupees (0 decimals — paisa are not used at retail)
//
// Nothing in the app multiplies or divides a float price. Rates (tax,
// discount) are applied here and rounded back to an integer immediately.
// ---------------------------------------------------------------------

/** Smallest representable step, e.g. 100 cents = 1 USD. */
export function minorPerMajor(config: RegionConfig): number {
  return 10 ** config.currency.decimals
}

/** Applies a rate to an amount and rounds to a whole minor unit. */
export function applyRate(amount: number, rate: number): number {
  return Math.round(amount * rate)
}

/**
 * Extracts the tax already baked into a tax-inclusive amount.
 * A 105 AED gross at 5% VAT contains 5 AED of VAT, not 5.25.
 */
export function taxWithin(grossAmount: number, rate: number): number {
  if (rate <= 0) return 0
  return Math.round(grossAmount - grossAmount / (1 + rate))
}

const formatterCache = new Map<string, Intl.NumberFormat>()

function formatterFor(config: RegionConfig, compact: boolean): Intl.NumberFormat {
  const key = `${config.locale}:${config.currency.code}:${config.currency.decimals}:${compact}`
  let fmt = formatterCache.get(key)
  if (!fmt) {
    fmt = new Intl.NumberFormat(config.locale, {
      style: 'currency',
      currency: config.currency.code,
      minimumFractionDigits: compact ? 0 : config.currency.decimals,
      maximumFractionDigits: config.currency.decimals,
      currencyDisplay: 'narrowSymbol',
    })
    formatterCache.set(key, fmt)
  }
  return fmt
}

/**
 * Renders a minor-unit integer in the region's own currency and locale.
 * `compact` drops trailing ".00" so grid prices stay quiet.
 */
export function formatMoney(amount: number, config: RegionConfig, compact = false): string {
  const major = amount / minorPerMajor(config)
  const dropDecimals = compact && Number.isInteger(major)
  try {
    return formatterFor(config, dropDecimals).format(major)
  } catch {
    // narrowSymbol is unsupported on a few older engines — fall back to
    // the plain symbol rather than losing the price entirely.
    const digits = dropDecimals ? 0 : config.currency.decimals
    return `${config.currency.symbol} ${major.toFixed(digits)}`
  }
}

/** "AED 400" style threshold copy for banners, without decimals. */
export function formatThreshold(amount: number, config: RegionConfig): string {
  return formatMoney(amount, config, true)
}

export function formatPercent(rate: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 3,
  }).format(rate)
}
