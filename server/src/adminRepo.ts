import { db } from './db'
import { badRequest, conflict, notFound } from './errors'
import { getOrder, getProductBySlug } from './repo'
import { REGIONS, REGION_CODES, type RegionCode, type RegionConfig } from '../../src/regions/config'
import type { Order, Product, Promo } from '../../src/types'

// ---------------------------------------------------------------------
// Writes.
//
// Kept apart from repo.ts so the read path a customer hits and the write
// path an operator hits are obviously different code. Every function
// here assumes the caller has already passed requireAdmin.
//
// Products are written whole — product plus all its variants, prices and
// stock in one transaction. Editing a product is not really "change this
// one field"; it is "here is what this product should now be", and a
// single replace is far easier to reason about than a dozen partial
// endpoints that can half-apply.
// ---------------------------------------------------------------------

export type VariantInput = {
  id?: string
  sku: string
  label: string
  options: { size?: string; color?: string; colorHex?: string }
  price: Record<RegionCode, number>
  compareAt?: Partial<Record<RegionCode, number>> | null
  stock: Record<RegionCode, number>
}

export type ProductInput = {
  id?: string
  slug: string
  name: string
  tagline: string
  description: string
  highlights: string[]
  rating: { average: number; count: number } | null
  category: string
  badges: string[]
  media: unknown[]
  specs: { label: string; value: string }[]
  featured: number
  weightGrams: number
  variants: VariantInput[]
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

function assertUniqueSlug(slug: string, ignoreId?: string): void {
  const row = db().prepare('SELECT id FROM products WHERE slug = ?').get(slug) as
    | { id: string }
    | undefined
  if (row && row.id !== ignoreId) {
    throw conflict('slug_taken', `Another product already uses the URL "${slug}".`)
  }
}

/**
 * Creates or replaces a product and everything hanging off it.
 *
 * Variants are matched by id where one is supplied. A variant the client
 * leaves out is deleted — along with its stock row, which is the part
 * worth being careful about: removing a variant throws away the stock
 * count for it in all three regions and cannot be undone from the UI.
 */
export function saveProduct(input: ProductInput): Product {
  const conn = db()

  const slug = slugify(input.slug || input.name)
  if (!slug) throw badRequest('invalid_slug', 'A product needs a name or a URL slug.')
  if (input.variants.length === 0) {
    throw badRequest('no_variants', 'A product needs at least one variant to be sold.')
  }

  const id = input.id?.trim() || slug
  assertUniqueSlug(slug, id)

  const existing = conn.prepare('SELECT id FROM products WHERE id = ?').get(id) as
    | { id: string }
    | undefined

  conn.exec('BEGIN IMMEDIATE')
  try {
    if (existing) {
      conn
        .prepare(
          `UPDATE products SET slug = ?, name = ?, tagline = ?, description = ?, category = ?,
             badges = ?, media = ?, specs = ?, highlights = ?, rating_average = ?, rating_count = ?,
             featured = ?, weight_grams = ?
           WHERE id = ?`,
        )
        .run(
          slug,
          input.name,
          input.tagline,
          input.description,
          input.category,
          JSON.stringify(input.badges),
          JSON.stringify(input.media),
          JSON.stringify(input.specs),
          JSON.stringify(input.highlights),
          input.rating?.average ?? null,
          input.rating?.count ?? null,
          input.featured,
          input.weightGrams,
          id,
        )
    } else {
      conn
        .prepare(
          `INSERT INTO products (id, slug, name, tagline, description, category, badges, media,
             specs, highlights, rating_average, rating_count, featured, weight_grams)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          slug,
          input.name,
          input.tagline,
          input.description,
          input.category,
          JSON.stringify(input.badges),
          JSON.stringify(input.media),
          JSON.stringify(input.specs),
          JSON.stringify(input.highlights),
          input.rating?.average ?? null,
          input.rating?.count ?? null,
          input.featured,
          input.weightGrams,
        )
    }

    const keptIds: string[] = []
    input.variants.forEach((variant, position) => {
      const variantId = variant.id?.trim() || `${id}-${slugify(variant.sku || variant.label)}`
      keptIds.push(variantId)

      const variantExists = conn.prepare('SELECT id FROM variants WHERE id = ?').get(variantId)
      if (variantExists) {
        conn
          .prepare(
            'UPDATE variants SET product_id = ?, sku = ?, label = ?, options = ?, position = ? WHERE id = ?',
          )
          .run(id, variant.sku, variant.label, JSON.stringify(variant.options ?? {}), position, variantId)
      } else {
        conn
          .prepare(
            'INSERT INTO variants (id, product_id, sku, label, options, position) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(variantId, id, variant.sku, variant.label, JSON.stringify(variant.options ?? {}), position)
      }

      for (const region of REGION_CODES) {
        conn
          .prepare(
            `INSERT INTO variant_prices (variant_id, region, price, compare_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(variant_id, region) DO UPDATE SET price = excluded.price, compare_at = excluded.compare_at`,
          )
          .run(variantId, region, Math.round(variant.price[region] ?? 0), variant.compareAt?.[region] ?? null)

        conn
          .prepare(
            `INSERT INTO stock (variant_id, region, quantity) VALUES (?, ?, ?)
             ON CONFLICT(variant_id, region) DO UPDATE SET quantity = excluded.quantity`,
          )
          .run(variantId, region, Math.max(0, Math.round(variant.stock[region] ?? 0)))
      }
    })

    // Anything no longer in the payload is gone.
    const placeholders = keptIds.map(() => '?').join(',') || "''"
    conn
      .prepare(`DELETE FROM variants WHERE product_id = ? AND id NOT IN (${placeholders})`)
      .run(id, ...keptIds)

    conn.exec('COMMIT')
  } catch (err) {
    conn.exec('ROLLBACK')
    throw err
  }

  return getProductBySlug(slug)
}

export function deleteProduct(id: string): void {
  const result = db().prepare('DELETE FROM products WHERE id = ?').run(id)
  if (result.changes === 0) throw notFound('not_found', 'No product with that id.')
}

// -------------------------------------------------------------- promos

export type PromoInput = {
  code: string
  label: string
  percentOff: number
  regions: RegionCode[]
  minSubtotal: Record<RegionCode, number>
  active: boolean
}

export function savePromo(input: PromoInput): Promo {
  const code = input.code.trim().toUpperCase()
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    throw badRequest('invalid_code', 'A promo code must be 3–40 letters, digits, hyphens or underscores.')
  }
  if (input.percentOff < 1 || input.percentOff > 90) {
    throw badRequest('invalid_percent', 'The discount must be between 1% and 90%.')
  }
  if (input.regions.length === 0) {
    throw badRequest('no_regions', 'Choose at least one store for this code to work in.')
  }

  db()
    .prepare(
      `INSERT INTO promos (code, label, percent_off, regions, min_subtotal, active)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         label = excluded.label, percent_off = excluded.percent_off,
         regions = excluded.regions, min_subtotal = excluded.min_subtotal,
         active = excluded.active`,
    )
    .run(
      code,
      input.label,
      Math.round(input.percentOff),
      JSON.stringify(input.regions),
      JSON.stringify(input.minSubtotal),
      input.active ? 1 : 0,
    )

  return listPromos().find((p) => p.code === code)!
}

export function listPromos(): (Promo & { active: boolean })[] {
  const rows = db().prepare('SELECT * FROM promos ORDER BY code').all() as unknown as {
    code: string
    label: string
    percent_off: number
    regions: string
    min_subtotal: string
    active: number
  }[]
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    percentOff: r.percent_off,
    regions: JSON.parse(r.regions) as RegionCode[],
    minSubtotal: JSON.parse(r.min_subtotal) as Record<RegionCode, number>,
    active: r.active === 1,
  }))
}

export function deletePromo(code: string): void {
  const result = db().prepare('DELETE FROM promos WHERE code = ?').run(code.toUpperCase())
  if (result.changes === 0) throw notFound('not_found', 'No promo code by that name.')
}

// -------------------------------------------------------------- orders

export function listAllOrders(limit = 100): Order[] {
  const rows = db()
    .prepare('SELECT number FROM orders ORDER BY placed_at DESC LIMIT ?')
    .all(limit) as unknown as { number: string }[]
  // Reuses the read path so an admin sees exactly what the customer sees.
  return rows.map((r) => getOrder(r.number))
}

const ORDER_STATUSES = ['confirmed', 'processing', 'shipped'] as const
const PAYMENT_STATUSES = ['pending', 'paid', 'due_on_delivery'] as const

export function updateOrder(
  number: string,
  patch: { status?: string; paymentStatus?: string },
): Order {
  getOrder(number) // 404s if it does not exist

  if (patch.status && !ORDER_STATUSES.includes(patch.status as (typeof ORDER_STATUSES)[number])) {
    throw badRequest('invalid_status', `Status must be one of ${ORDER_STATUSES.join(', ')}.`)
  }
  if (
    patch.paymentStatus &&
    !PAYMENT_STATUSES.includes(patch.paymentStatus as (typeof PAYMENT_STATUSES)[number])
  ) {
    throw badRequest('invalid_payment_status', `Payment status must be one of ${PAYMENT_STATUSES.join(', ')}.`)
  }

  if (patch.status) {
    db().prepare('UPDATE orders SET status = ? WHERE number = ?').run(patch.status, number.toUpperCase())
  }
  if (patch.paymentStatus) {
    db()
      .prepare('UPDATE orders SET payment_status = ? WHERE number = ?')
      .run(patch.paymentStatus, number.toUpperCase())
  }

  return getOrder(number)
}

// ------------------------------------------------------------ settings

/**
 * Per-region overrides for the bits of a storefront an operator actually
 * changes: the promo strip, the hero copy, support details, delivery
 * prices and the tax rate.
 *
 * Stored as a patch rather than a full copy of the region config, so
 * anything left unset keeps following the defaults in
 * src/regions/config.ts and new fields added there appear automatically.
 */
export type RegionSettings = {
  promoStrip?: string
  heroEyebrow?: string
  heroTitle?: string
  heroBody?: string
  supportEmail?: string
  supportPhone?: string
  taxRate?: number
  shipping?: { id: string; label: string; eta: string; amount: number; freeOver: number | null }[]
}

export function getSettings(region: RegionCode): RegionSettings {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(`region:${region}`) as
    | { value: string }
    | undefined
  if (!row) return {}
  try {
    return JSON.parse(row.value) as RegionSettings
  } catch {
    return {}
  }
}

export function putSettings(region: RegionCode, settings: RegionSettings): RegionSettings {
  if (settings.taxRate !== undefined && (settings.taxRate < 0 || settings.taxRate > 0.5)) {
    throw badRequest('invalid_tax', 'Tax rate must be between 0 and 0.5 (0–50%).')
  }
  for (const tier of settings.shipping ?? []) {
    if (tier.amount < 0) throw badRequest('invalid_shipping', 'Delivery prices cannot be negative.')
  }

  db()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(`region:${region}`, JSON.stringify(settings), new Date().toISOString())

  return settings
}

/**
 * The region config with any saved overrides folded in.
 *
 * Everything that prices an order goes through this rather than reading
 * REGIONS directly, so an operator changing the tax rate or a delivery
 * price in the dashboard changes what customers are actually charged —
 * not just what the marketing copy says.
 */
export function resolveRegionConfig(region: RegionCode): RegionConfig {
  const base = REGIONS[region]
  const overrides = getSettings(region)
  if (Object.keys(overrides).length === 0) return base

  return {
    ...base,
    taxRate: overrides.taxRate ?? base.taxRate,
    hero: {
      ...base.hero,
      promo: overrides.promoStrip ?? base.hero.promo,
      eyebrow: overrides.heroEyebrow ?? base.hero.eyebrow,
    },
    support: {
      ...base.support,
      email: overrides.supportEmail ?? base.support.email,
      phone: overrides.supportPhone ?? base.support.phone,
    },
    shipping: overrides.shipping?.length
      ? overrides.shipping.map((tier) => {
          const original = base.shipping.find((t) => t.id === tier.id)
          return {
            id: tier.id,
            label: tier.label,
            eta: tier.eta,
            // etaDays drives the delivery-date estimate and has no field
            // in the editor, so it keeps whatever the default tier had.
            etaDays: original?.etaDays ?? [2, 5],
            amount: Math.round(tier.amount),
            ...(tier.freeOver != null ? { freeOver: Math.round(tier.freeOver) } : {}),
          }
        })
      : base.shipping,
  }
}

/** Everything the storefront needs to render a region's editable copy. */
export function publicSettings(region: RegionCode) {
  const overrides = getSettings(region)
  const config = resolveRegionConfig(region)
  return {
    promoStrip: config.hero.promo,
    heroEyebrow: config.hero.eyebrow,
    heroTitle: overrides.heroTitle ?? null,
    heroBody: overrides.heroBody ?? null,
    supportEmail: config.support.email,
    supportPhone: config.support.phone,
    taxRate: config.taxRate,
    shipping: config.shipping.map((t) => ({
      id: t.id,
      label: t.label,
      eta: t.eta,
      amount: t.amount,
      freeOver: t.freeOver ?? null,
    })),
  }
}
