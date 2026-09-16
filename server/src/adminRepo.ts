import { badRequest, conflict, notFound } from './errors.js'
import { getOrder, getProductBySlug, toOrder, ORDER_SELECT, type OrderRow } from './repo.js'
import { query, transaction } from './db.js'
import { REGIONS, REGION_CODES, type RegionCode, type RegionConfig } from '../../src/regions/config.js'
import type { Order, Product, Promo } from '../../src/types.js'

// ---------------------------------------------------------------------
// Writes.
//
// Kept apart from repo.ts so the read path a customer hits and the write
// path an operator hits are obviously different code. Everything here
// assumes the caller has already passed requireAdmin.
//
// A product is written whole. Editing one is not really "change this
// field"; it is "here is what this product should now be", and replacing
// the document is far easier to reason about than a dozen partial
// updates that can half-apply.
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
  /** Collection ids. Omitted leaves existing memberships alone. */
  collections?: string[]
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

export async function saveProduct(input: ProductInput): Promise<Product> {
  const slug = slugify(input.slug || input.name)
  if (!slug) throw badRequest('invalid_slug', 'A product needs a name or a URL slug.')
  if (input.variants.length === 0) {
    throw badRequest('no_variants', 'A product needs at least one variant to be sold.')
  }

  const id = input.id?.trim() || slug

  const clash = await query<{ id: string }>('SELECT id FROM products WHERE slug = $1 AND id <> $2', [
    slug,
    id,
  ])
  if (clash.rowCount) throw conflict('slug_taken', `Another product already uses the URL "${slug}".`)

  // Variant ids are derived once, up front: the delete below and the
  // inserts after it must agree on exactly which variants survive.
  const keep = input.variants.map((v) => v.id?.trim() || `${id}-${slugify(v.sku || v.label)}`)

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO products (id, slug, name, tagline, description, highlights,
                             rating_average, rating_count, category, badges,
                             media, specs, featured, weight_grams)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug, name = EXCLUDED.name, tagline = EXCLUDED.tagline,
         description = EXCLUDED.description, highlights = EXCLUDED.highlights,
         rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
         category = EXCLUDED.category, badges = EXCLUDED.badges, media = EXCLUDED.media,
         specs = EXCLUDED.specs, featured = EXCLUDED.featured,
         weight_grams = EXCLUDED.weight_grams`,
      [
        id,
        slug,
        input.name,
        input.tagline,
        input.description,
        input.highlights,
        input.rating?.average ?? null,
        input.rating?.count ?? null,
        input.category,
        input.badges,
        JSON.stringify(input.media ?? []),
        JSON.stringify(input.specs ?? []),
        input.featured,
        input.weightGrams,
      ],
    )

    // Replacing the whole product means a variant left out of the payload
    // is gone, along with its stock counts in every region. Deleting the
    // variant rows cascades to variant_regions. order_lines hold their own
    // snapshot and are deliberately not foreign-keyed to variants, so past
    // orders survive a product being reshaped or deleted.
    await client.query('DELETE FROM variants WHERE product_id = $1 AND NOT (id = ANY($2))', [
      id,
      keep,
    ])

    // Memberships are replaced wholesale, like variants: what the form
    // submits is the complete set. Skipped entirely when the caller omits
    // the field, so a partial update cannot silently unfile a product.
    if (input.collections) {
      await client.query('DELETE FROM product_collections WHERE product_id = $1', [id])
      for (const collectionId of [...new Set(input.collections)]) {
        await client.query(
          `INSERT INTO product_collections (product_id, collection_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [id, collectionId],
        )
      }
    }

    for (const [index, v] of input.variants.entries()) {
      const variantId = keep[index]
      await client.query(
        `INSERT INTO variants (id, product_id, sku, label, options, position)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           product_id = EXCLUDED.product_id, sku = EXCLUDED.sku, label = EXCLUDED.label,
           options = EXCLUDED.options, position = EXCLUDED.position`,
        [variantId, id, v.sku, v.label, JSON.stringify(v.options ?? {}), index],
      )

      for (const r of REGION_CODES) {
        await client.query(
          `INSERT INTO variant_regions (variant_id, region, price, compare_at, stock)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (variant_id, region) DO UPDATE SET
             price = EXCLUDED.price, compare_at = EXCLUDED.compare_at, stock = EXCLUDED.stock`,
          [
            variantId,
            r,
            Math.round(v.price[r] ?? 0),
            v.compareAt?.[r] ?? null,
            Math.max(0, Math.round(v.stock[r] ?? 0)),
          ],
        )
      }
    }
  })

  return getProductBySlug(slug)
}

export async function deleteProduct(id: string): Promise<void> {
  const result = await query('DELETE FROM products WHERE id = $1', [id])
  if (result.rowCount === 0) throw notFound('not_found', 'No product with that id.')
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

export async function savePromo(input: PromoInput): Promise<Promo & { active: boolean }> {
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

  await query(
    `INSERT INTO promos (code, label, percent_off, regions, min_subtotal, active)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (code) DO UPDATE SET
       label = EXCLUDED.label, percent_off = EXCLUDED.percent_off,
       regions = EXCLUDED.regions, min_subtotal = EXCLUDED.min_subtotal,
       active = EXCLUDED.active`,
    [
      code,
      input.label,
      Math.round(input.percentOff),
      input.regions,
      JSON.stringify(input.minSubtotal),
      input.active,
    ],
  )

  return (await listPromos()).find((p) => p.code === code)!
}

export async function listPromos(): Promise<(Promo & { active: boolean })[]> {
  const { rows } = await query<{
    code: string
    label: string
    percent_off: number
    regions: string[]
    min_subtotal: Record<RegionCode, number>
    active: boolean
  }>('SELECT * FROM promos ORDER BY code')

  return rows.map((d) => ({
    code: d.code,
    label: d.label,
    percentOff: d.percent_off,
    regions: d.regions as RegionCode[],
    minSubtotal: d.min_subtotal,
    active: d.active !== false,
  }))
}

export async function deletePromo(code: string): Promise<void> {
  const result = await query('DELETE FROM promos WHERE code = $1', [code.toUpperCase()])
  if (result.rowCount === 0) throw notFound('not_found', 'No promo code by that name.')
}

// -------------------------------------------------------------- orders

export async function listAllOrders(limit = 100): Promise<Order[]> {
  const { rows } = await query<OrderRow>(`${ORDER_SELECT} ORDER BY o.placed_at DESC LIMIT $1`, [
    limit,
  ])
  return rows.map(toOrder)
}

const ORDER_STATUSES = ['confirmed', 'processing', 'shipped'] as const
const PAYMENT_STATUSES = ['pending', 'paid', 'due_on_delivery'] as const

export async function updateOrder(
  number: string,
  patch: { status?: string; paymentStatus?: string },
): Promise<Order> {
  await getOrder(number) // 404s if it does not exist

  if (patch.status && !ORDER_STATUSES.includes(patch.status as (typeof ORDER_STATUSES)[number])) {
    throw badRequest('invalid_status', `Status must be one of ${ORDER_STATUSES.join(', ')}.`)
  }
  if (
    patch.paymentStatus &&
    !PAYMENT_STATUSES.includes(patch.paymentStatus as (typeof PAYMENT_STATUSES)[number])
  ) {
    throw badRequest(
      'invalid_payment_status',
      `Payment status must be one of ${PAYMENT_STATUSES.join(', ')}.`,
    )
  }

  const sets: string[] = []
  const params: unknown[] = [number.trim().toUpperCase()]
  if (patch.status) {
    params.push(patch.status)
    sets.push(`status = $${params.length}`)
  }
  if (patch.paymentStatus) {
    params.push(patch.paymentStatus)
    sets.push(`payment_status = $${params.length}`)
  }

  if (sets.length) {
    await query(`UPDATE orders SET ${sets.join(', ')} WHERE number = $1`, params)
  }

  return getOrder(number)
}

// ------------------------------------------------------------ settings

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

export async function getSettings(region: RegionCode): Promise<RegionSettings> {
  const { rows } = await query<{ value: RegionSettings }>(
    'SELECT value FROM settings WHERE id = $1',
    [`region:${region}`],
  )
  return rows[0]?.value ?? {}
}

export async function putSettings(
  region: RegionCode,
  value: RegionSettings,
): Promise<RegionSettings> {
  if (value.taxRate !== undefined && (value.taxRate < 0 || value.taxRate > 0.5)) {
    throw badRequest('invalid_tax', 'Tax rate must be between 0 and 0.5 (0–50%).')
  }
  for (const tier of value.shipping ?? []) {
    if (tier.amount < 0) throw badRequest('invalid_shipping', 'Delivery prices cannot be negative.')
  }

  await query(
    `INSERT INTO settings (id, value, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [`region:${region}`, JSON.stringify(value)],
  )

  return value
}

/**
 * The region config with any saved overrides folded in.
 *
 * Everything that prices an order goes through this rather than reading
 * REGIONS directly, so an operator changing the tax rate or a delivery
 * price in the dashboard changes what customers are actually charged.
 */
export async function resolveRegionConfig(region: RegionCode): Promise<RegionConfig> {
  const base = REGIONS[region]
  const overrides = await getSettings(region)
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
            // Not editable in the dashboard, so it keeps the default.
            etaDays: original?.etaDays ?? ([2, 5] as [number, number]),
            amount: Math.round(tier.amount),
            ...(tier.freeOver != null ? { freeOver: Math.round(tier.freeOver) } : {}),
          }
        })
      : base.shipping,
  }
}

/** Everything the storefront needs to render a region's editable copy. */
export async function publicSettings(region: RegionCode) {
  const overrides = await getSettings(region)
  const config = await resolveRegionConfig(region)
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

// ------------------------------------------------- categories & collections

export type TaxonomyInput = {
  id?: string
  label: string
  /** Blurb for a category, description for a collection. */
  body?: string
  position?: number
  active?: boolean
}

export type CategoryRow = {
  id: string
  label: string
  blurb: string
  position: number
  active: boolean
  /** How many products are filed under it. Read-only. */
  productCount: number
}

export type CollectionRow = {
  id: string
  label: string
  description: string
  position: number
  active: boolean
  productCount: number
}

function taxonomyId(input: TaxonomyInput): string {
  const id = slugify(input.id || input.label)
  if (!id) throw badRequest('invalid_id', 'A name is required.')
  return id
}

function taxonomyLabel(input: TaxonomyInput): string {
  const label = input.label.trim()
  if (!label) throw badRequest('invalid_label', 'A name is required.')
  if (label.length > 60) throw badRequest('invalid_label', 'Keep the name under 60 characters.')
  return label
}

export async function listCategories(): Promise<CategoryRow[]> {
  const { rows } = await query<{
    id: string
    label: string
    blurb: string
    position: number
    active: boolean
    product_count: string
  }>(
    `SELECT c.*, (SELECT count(*) FROM products p WHERE p.category = c.id)::text AS product_count
       FROM categories c ORDER BY c.position, c.label`,
  )
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    blurb: r.blurb,
    position: r.position,
    active: r.active,
    productCount: Number(r.product_count),
  }))
}

export async function saveCategory(input: TaxonomyInput): Promise<CategoryRow> {
  const id = taxonomyId(input)
  await query(
    `INSERT INTO categories (id, label, blurb, position, active)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET
       label = EXCLUDED.label, blurb = EXCLUDED.blurb,
       position = EXCLUDED.position, active = EXCLUDED.active`,
    [id, taxonomyLabel(input), input.body ?? '', Math.round(input.position ?? 0), input.active ?? true],
  )
  const found = (await listCategories()).find((c) => c.id === id)
  if (!found) throw notFound('not_found', 'The category did not save.')
  return found
}

/**
 * Categories are not foreign-keyed from products, so deleting one cannot
 * cascade into the catalogue. It would instead leave those products
 * filed under an id that no longer resolves, which is why this refuses
 * while any product still uses it.
 */
export async function deleteCategory(id: string): Promise<void> {
  const { rows } = await query<{ count: string }>(
    'SELECT count(*)::text AS count FROM products WHERE category = $1',
    [id],
  )
  const count = Number(rows[0].count)
  if (count > 0) {
    throw conflict(
      'category_in_use',
      `${count} product${count === 1 ? ' is' : 's are'} still in this department. Move them first.`,
    )
  }
  const result = await query('DELETE FROM categories WHERE id = $1', [id])
  if (result.rowCount === 0) throw notFound('not_found', 'No category with that id.')
}

export async function listCollections(): Promise<CollectionRow[]> {
  const { rows } = await query<{
    id: string
    label: string
    description: string
    position: number
    active: boolean
    product_count: string
  }>(
    `SELECT c.*,
            (SELECT count(*) FROM product_collections pc WHERE pc.collection_id = c.id)::text
              AS product_count
       FROM collections c ORDER BY c.position, c.label`,
  )
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    position: r.position,
    active: r.active,
    productCount: Number(r.product_count),
  }))
}

export async function saveCollection(input: TaxonomyInput): Promise<CollectionRow> {
  const id = taxonomyId(input)
  await query(
    `INSERT INTO collections (id, label, description, position, active)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET
       label = EXCLUDED.label, description = EXCLUDED.description,
       position = EXCLUDED.position, active = EXCLUDED.active`,
    [id, taxonomyLabel(input), input.body ?? '', Math.round(input.position ?? 0), input.active ?? true],
  )
  const found = (await listCollections()).find((c) => c.id === id)
  if (!found) throw notFound('not_found', 'The collection did not save.')
  return found
}

/**
 * Safe to delete at any time, unlike a category: product_collections
 * cascades, so the memberships go and the products themselves are
 * untouched.
 */
export async function deleteCollection(id: string): Promise<void> {
  const result = await query('DELETE FROM collections WHERE id = $1', [id])
  if (result.rowCount === 0) throw notFound('not_found', 'No collection by that name.')
}
