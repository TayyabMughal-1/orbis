import { badRequest, conflict, notFound } from './errors'
import { getOrder, getProductBySlug, toOrder } from './repo'
import { orders, products, promos, settings, type ProductDoc } from './mongo'
import { REGIONS, REGION_CODES, type RegionCode, type RegionConfig } from '../../src/regions/config'
import type { Order, Product, Promo } from '../../src/types'

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

  const clash = await products().findOne({ slug, _id: { $ne: id } }, { projection: { _id: 1 } })
  if (clash) throw conflict('slug_taken', `Another product already uses the URL "${slug}".`)

  const doc: Omit<ProductDoc, '_id'> = {
    slug,
    name: input.name,
    tagline: input.tagline,
    description: input.description,
    highlights: input.highlights,
    rating: input.rating,
    category: input.category,
    badges: input.badges,
    media: input.media as ProductDoc['media'],
    specs: input.specs,
    featured: input.featured,
    weightGrams: input.weightGrams,
    variants: input.variants.map((v) => ({
      id: v.id?.trim() || `${id}-${slugify(v.sku || v.label)}`,
      sku: v.sku,
      label: v.label,
      options: v.options ?? {},
      price: Object.fromEntries(
        REGION_CODES.map((r) => [r, Math.round(v.price[r] ?? 0)]),
      ) as Record<RegionCode, number>,
      compareAt: v.compareAt ?? null,
      stock: Object.fromEntries(
        REGION_CODES.map((r) => [r, Math.max(0, Math.round(v.stock[r] ?? 0))]),
      ) as Record<RegionCode, number>,
    })),
  }

  // Replacing the whole document means a variant left out of the payload
  // is gone — along with its stock counts in every region.
  await products().updateOne({ _id: id }, { $set: doc }, { upsert: true })

  return getProductBySlug(slug)
}

export async function deleteProduct(id: string): Promise<void> {
  const result = await products().deleteOne({ _id: id })
  if (result.deletedCount === 0) throw notFound('not_found', 'No product with that id.')
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

  await promos().updateOne(
    { _id: code },
    {
      $set: {
        label: input.label,
        percentOff: Math.round(input.percentOff),
        regions: input.regions,
        minSubtotal: input.minSubtotal,
        active: input.active,
      },
    },
    { upsert: true },
  )

  return (await listPromos()).find((p) => p.code === code)!
}

export async function listPromos(): Promise<(Promo & { active: boolean })[]> {
  const docs = await promos().find().sort({ _id: 1 }).toArray()
  return docs.map((d) => ({
    code: d._id,
    label: d.label,
    percentOff: d.percentOff,
    regions: d.regions,
    minSubtotal: d.minSubtotal,
    active: d.active !== false,
  }))
}

export async function deletePromo(code: string): Promise<void> {
  const result = await promos().deleteOne({ _id: code.toUpperCase() })
  if (result.deletedCount === 0) throw notFound('not_found', 'No promo code by that name.')
}

// -------------------------------------------------------------- orders

export async function listAllOrders(limit = 100): Promise<Order[]> {
  const docs = await orders().find().sort({ placedAt: -1 }).limit(limit).toArray()
  return docs.map(toOrder)
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

  const set: Record<string, string> = {}
  if (patch.status) set.status = patch.status
  if (patch.paymentStatus) set.paymentStatus = patch.paymentStatus

  if (Object.keys(set).length) {
    await orders().updateOne({ _id: number.trim().toUpperCase() }, { $set: set })
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
  const doc = await settings().findOne({ _id: `region:${region}` })
  return (doc?.value as RegionSettings) ?? {}
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

  await settings().updateOne(
    { _id: `region:${region}` },
    { $set: { value, updatedAt: new Date().toISOString() } },
    { upsert: true },
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
