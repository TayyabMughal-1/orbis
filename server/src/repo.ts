import { conflict, notFound } from './errors.js'
import { orders, products, promos, type OrderDoc, type ProductDoc } from './mongo.js'
import type { RegionCode } from '../../src/regions/config.js'
import type {
  Address,
  Category,
  Order,
  OrderLineSnapshot,
  OrderTotals,
  PriceByRegion,
  Product,
  Promo,
  ShippingQuote,
  Variant,
} from '../../src/types.js'

// ---------------------------------------------------------------------
// Reads.
//
// Documents come back in the exact shapes the storefront already used,
// so swapping the database underneath changed nothing above this line.
// ---------------------------------------------------------------------

function toProduct(doc: ProductDoc): Product {
  return {
    id: doc._id,
    slug: doc.slug,
    name: doc.name,
    tagline: doc.tagline,
    description: doc.description,
    highlights: doc.highlights ?? [],
    rating: doc.rating ?? null,
    category: doc.category as Category,
    badges: doc.badges ?? [],
    media: doc.media ?? [],
    specs: doc.specs ?? [],
    featured: doc.featured ?? 0,
    weightGrams: doc.weightGrams ?? 0,
    variants: (doc.variants ?? []).map(
      (v): Variant => ({
        id: v.id,
        sku: v.sku,
        label: v.label,
        options: v.options ?? {},
        price: v.price as PriceByRegion,
        compareAt: v.compareAt ?? undefined,
        stock: v.stock as PriceByRegion,
      }),
    ),
  }
}

// ---------------------------------------------------------- catalogue

export type ListFilter = {
  region: RegionCode
  category?: Category | 'all'
  search?: string
  sort?: 'featured' | 'price-asc' | 'price-desc' | 'name'
  inStockOnly?: boolean
  limit?: number
}

export async function listProducts(filter: ListFilter): Promise<Product[]> {
  const query: Record<string, unknown> = {}

  if (filter.category && filter.category !== 'all') query.category = filter.category

  if (filter.search?.trim()) {
    // Escaped so a customer typing "(" cannot throw a regex error, and
    // so search terms are never treated as patterns.
    const needle = filter.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rx = { $regex: needle, $options: 'i' }
    query.$or = [{ name: rx }, { tagline: rx }, { description: rx }, { category: rx }]
  }

  const docs = await products()
    .find(query)
    .sort({ featured: -1, name: 1 })
    .toArray()

  let rows = docs.map(toProduct)

  if (filter.inStockOnly) {
    rows = rows.filter((p) => p.variants.some((v) => v.stock[filter.region] > 0))
  }

  // Price sorts depend on which region is asking, so they happen here
  // rather than in the query.
  const lowest = (p: Product) => Math.min(...p.variants.map((v) => v.price[filter.region]))
  switch (filter.sort) {
    case 'price-asc':
      rows.sort((a, b) => lowest(a) - lowest(b))
      break
    case 'price-desc':
      rows.sort((a, b) => lowest(b) - lowest(a))
      break
    case 'name':
      rows.sort((a, b) => a.name.localeCompare(b.name))
      break
    default:
      break
  }

  return filter.limit ? rows.slice(0, filter.limit) : rows
}

export async function getProductBySlug(slug: string): Promise<Product> {
  const doc = await products().findOne({ slug })
  if (!doc) throw notFound('not_found', `No product with the slug "${slug}".`)
  return toProduct(doc)
}

export async function getRelated(slug: string, region: RegionCode, limit = 4): Promise<Product[]> {
  const target = await products().findOne({ slug }, { projection: { category: 1 } })
  if (!target) return []

  const docs = await products()
    .find({ _id: { $ne: target._id } })
    .sort({ featured: -1 })
    .limit(24)
    .toArray()

  return docs
    .map(toProduct)
    // Same department first, then anything else that is actually buyable.
    .sort((a, b) => Number(b.category === target.category) - Number(a.category === target.category))
    .filter((p) => p.variants.some((v) => v.stock[region] > 0))
    .slice(0, limit)
}

export async function getVariantsByIds(
  ids: string[],
): Promise<Map<string, { variant: Variant; product: Product }>> {
  const map = new Map<string, { variant: Variant; product: Product }>()
  if (ids.length === 0) return map

  const docs = await products().find({ 'variants.id': { $in: ids } }).toArray()
  for (const doc of docs) {
    const product = toProduct(doc)
    for (const variant of product.variants) {
      if (ids.includes(variant.id)) map.set(variant.id, { variant, product })
    }
  }
  return map
}

// ------------------------------------------------------------- promos

export async function getPromo(code: string): Promise<Promo | null> {
  const doc = await promos().findOne({ _id: code.trim().toUpperCase(), active: true })
  if (!doc) return null
  return {
    code: doc._id,
    label: doc.label,
    percentOff: doc.percentOff,
    regions: doc.regions,
    minSubtotal: doc.minSubtotal as PriceByRegion,
  }
}

// ------------------------------------------------------------- orders

const ORDER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateOrderNumber(region: RegionCode): string {
  let tail = ''
  for (let i = 0; i < 6; i += 1) {
    tail += ORDER_ALPHABET[Math.floor(Math.random() * ORDER_ALPHABET.length)]
  }
  return `ORB-${region.toUpperCase()}-${tail}`
}

export type NewOrder = {
  region: RegionCode
  email: string
  address: Address
  shipping: ShippingQuote
  paymentMethodId: string
  paymentMethodLabel: string
  paymentStatus: Order['paymentStatus']
  paymentReference: string | null
  promoCode: string | null
  lines: (OrderLineSnapshot & { variantId: string })[]
  totals: OrderTotals
  idempotencyKey: string | null
}

/**
 * Writes the order and decrements stock together.
 *
 * The guard lives in the update filter: a variant only matches while it
 * still holds enough stock, so two people buying the last item cannot
 * both succeed — the loser's update matches nothing and the whole
 * transaction is abandoned.
 */
export async function createOrder(input: NewOrder): Promise<Order> {
  if (input.idempotencyKey) {
    const existing = await orders().findOne({ idempotencyKey: input.idempotencyKey })
    if (existing) return toOrder(existing)
  }

  const { getClient } = await import('./mongo.js')
  const session = getClient().startSession()
  const number = generateOrderNumber(input.region)

  try {
    await session.withTransaction(async () => {
      for (const line of input.lines) {
        const result = await products().updateOne(
          {
            variants: {
              $elemMatch: { id: line.variantId, [`stock.${input.region}`]: { $gte: line.quantity } },
            },
          },
          { $inc: { [`variants.$.stock.${input.region}`]: -line.quantity } },
          { session },
        )

        if (result.modifiedCount !== 1) {
          throw conflict(
            'out_of_stock',
            `${line.productName} (${line.variantLabel}) sold out while you were checking out.`,
          )
        }
      }

      await orders().insertOne(
        {
          _id: number,
          region: input.region,
          placedAt: new Date().toISOString(),
          status: 'confirmed',
          paymentStatus: input.paymentStatus,
          email: input.email,
          address: input.address,
          shipping: input.shipping,
          paymentMethodId: input.paymentMethodId,
          paymentMethodLabel: input.paymentMethodLabel,
          paymentReference: input.paymentReference,
          promoCode: input.promoCode,
          totals: input.totals,
          lines: input.lines,
          idempotencyKey: input.idempotencyKey,
        },
        { session },
      )
    })
  } finally {
    await session.endSession()
  }

  return getOrder(number)
}

function toOrder(doc: OrderDoc): Order {
  return {
    number: doc._id,
    region: doc.region,
    placedAt: doc.placedAt,
    status: doc.status as Order['status'],
    paymentStatus: doc.paymentStatus as Order['paymentStatus'],
    email: doc.email,
    address: doc.address,
    shipping: doc.shipping,
    paymentMethodId: doc.paymentMethodId,
    paymentMethodLabel: doc.paymentMethodLabel,
    promoCode: doc.promoCode,
    totals: doc.totals,
    lines: doc.lines.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      variantLabel: l.variantLabel,
      sku: l.sku,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
  }
}

export async function getOrder(number: string): Promise<Order> {
  const doc = await orders().findOne({ _id: number.trim().toUpperCase() })
  if (!doc) throw notFound('not_found', `We could not find order ${number}.`)
  return toOrder(doc)
}

/** Only ever listed for a known email — otherwise this hands out the book. */
export async function listOrdersByEmail(region: RegionCode, email: string): Promise<Order[]> {
  const docs = await orders()
    .find({ region, email: { $regex: `^${email.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })
    .sort({ placedAt: -1 })
    .limit(50)
    .toArray()
  return docs.map(toOrder)
}

export { toOrder }
