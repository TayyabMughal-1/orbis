import { badRequest } from './errors'
import { REGIONS, isRegionCode, type RegionCode } from '../../src/regions/config'
import type { Address, CartLine } from '../../src/types'

// ---------------------------------------------------------------------
// Request validation, by hand.
//
// Small enough not to justify a schema library, and explicit about the
// one rule that matters: the client sends variant ids and quantities.
// It never sends a price. Prices come from the database.
// ---------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_LINES = 30
const MAX_QUANTITY = 10

export function asRegion(value: unknown, field = 'region'): RegionCode {
  if (!isRegionCode(value)) {
    throw badRequest('invalid_region', `"${field}" must be one of us, ae or pk.`)
  }
  return value
}

export function asString(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('invalid_field', `"${field}" is required.`)
  }
  if (value.length > max) {
    throw badRequest('invalid_field', `"${field}" is too long.`)
  }
  return value.trim()
}

export function asOptionalString(value: unknown, field: string, max = 200): string {
  if (value === undefined || value === null || value === '') return ''
  return asString(value, field, max)
}

export function asEmail(value: unknown): string {
  const email = asString(value, 'email', 254)
  if (!EMAIL_RE.test(email)) throw badRequest('invalid_email', 'That email address is not valid.')
  return email.toLowerCase()
}

export function asCartLines(value: unknown): CartLine[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest('cart_empty', 'There is nothing in your cart.')
  }
  if (value.length > MAX_LINES) {
    throw badRequest('cart_too_large', `A single order can hold at most ${MAX_LINES} lines.`)
  }

  const seen = new Set<string>()
  return value.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw badRequest('invalid_line', `Cart line ${i + 1} is malformed.`)
    }
    const line = raw as Record<string, unknown>
    const variantId = asString(line.variantId, `lines[${i}].variantId`, 100)
    const productId = asString(line.productId, `lines[${i}].productId`, 100)

    if (seen.has(variantId)) {
      throw badRequest('duplicate_line', 'The same item appears twice in the cart.')
    }
    seen.add(variantId)

    const quantity = Number(line.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw badRequest(
        'invalid_quantity',
        `Quantity for each line must be a whole number between 1 and ${MAX_QUANTITY}.`,
      )
    }

    return { productId, variantId, quantity, addedAt: Date.now() }
  })
}

/**
 * Address rules are per market — the emirate list, the ZIP format and
 * the phone shape all come from the same region config the storefront
 * validates against, so the two can never disagree.
 */
export function asAddress(value: unknown, region: RegionCode): Address {
  if (typeof value !== 'object' || value === null) {
    throw badRequest('invalid_address', 'A delivery address is required.')
  }
  const raw = value as Record<string, unknown>
  const config = REGIONS[region]
  const fmt = config.address

  const fullName = asString(raw.fullName, 'fullName', 120)
  if (fullName.length < 2) throw badRequest('invalid_address', 'Please give a full name for delivery.')

  const email = asEmail(raw.email)
  const line1 = asString(raw.line1, 'line1', 200)
  const line2 = asOptionalString(raw.line2, 'line2', 200)
  const city = asString(raw.city, 'city', 100)

  const subRegion = asString(raw.region, fmt.regionLabel, 100)
  if (!fmt.regionOptions.includes(subRegion)) {
    throw badRequest('invalid_address', `"${subRegion}" is not a ${fmt.regionLabel} we deliver to.`)
  }

  const phoneDigits = asString(raw.phone, 'phone', 40).replace(/[^\d]/g, '')
  const national = phoneDigits.startsWith(fmt.phonePrefix.replace('+', ''))
    ? phoneDigits.slice(fmt.phonePrefix.length - 1)
    : phoneDigits
  if (!fmt.phonePattern.test(national)) {
    throw badRequest(
      'invalid_phone',
      `That does not look like a ${config.country} number. Example: ${fmt.phonePlaceholder}`,
    )
  }

  const postalCode = asOptionalString(raw.postalCode, fmt.postalLabel, 20)
  if (fmt.postalPattern) {
    if (!postalCode) throw badRequest('invalid_address', `${fmt.postalLabel} is required.`)
    if (!fmt.postalPattern.test(postalCode)) {
      throw badRequest('invalid_address', `${fmt.postalLabel} looks wrong. Example: ${fmt.postalPlaceholder}`)
    }
  }

  return {
    fullName,
    email,
    phone: `${fmt.phonePrefix} ${national}`,
    line1,
    line2,
    city,
    region: subRegion,
    postalCode,
    countryCode: config.countryCode,
  }
}
