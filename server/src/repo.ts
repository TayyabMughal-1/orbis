import { db } from './db'
import { conflict, notFound } from './errors'
import { REGION_CODES, type RegionCode } from '../../src/regions/config'
import type {
  Category,
  MediaItem,
  Order,
  OrderLineSnapshot,
  OrderTotals,
  PriceByRegion,
  Product,
  Promo,
  ShippingQuote,
  StockByRegion,
  Variant,
  VariantOptions,
  Address,
} from '../../src/types'

// ---------------------------------------------------------------------
// Every SQL statement in the service lives here.
//
// Rows come back with per-region price and stock maps already assembled,
// so the shapes the API returns are exactly the shapes the storefront
// already had from the mock — the client swap needed no type changes.
// ---------------------------------------------------------------------

type ProductRow = {
  id: string
  slug: string
  name: string
  tagline: string
  description: string
  category: string
  badges: string
  media: string
  specs: string
  highlights: string
  rating_average: number | null
  rating_count: number | null
  featured: number
  weight_grams: number
}

type VariantRow = {
  id: string
  product_id: string
  sku: string
  label: string
  options: string
  position: number
}

const emptyByRegion = (): PriceByRegion => ({ us: 0, ae: 0, pk: 0 })

function hydrate(rows: ProductRow[]): Product[] {
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')

  const variantRows = db()
    .prepare(
      `SELECT * FROM variants WHERE product_id IN (${placeholders}) ORDER BY product_id, position`,
    )
    .all(...ids) as unknown as VariantRow[]

  const variantIds = variantRows.map((v) => v.id)
  const vPlaceholders = variantIds.map(() => '?').join(',') || "''"

  const priceRows = db()
    .prepare(`SELECT * FROM variant_prices WHERE variant_id IN (${vPlaceholders})`)
    .all(...variantIds) as unknown as {
    variant_id: string
    region: RegionCode
    price: number
    compare_at: number | null
  }[]

  const stockRows = db()
    .prepare(`SELECT * FROM stock WHERE variant_id IN (${vPlaceholders})`)
    .all(...variantIds) as unknown as {
    variant_id: string
    region: RegionCode
    quantity: number
  }[]

  const priceByVariant = new Map<string, PriceByRegion>()
  const compareByVariant = new Map<string, Partial<PriceByRegion>>()
  for (const row of priceRows) {
    if (!priceByVariant.has(row.variant_id)) priceByVariant.set(row.variant_id, emptyByRegion())
    priceByVariant.get(row.variant_id)![row.region] = row.price
    if (row.compare_at != null) {
      if (!compareByVariant.has(row.variant_id)) compareByVariant.set(row.variant_id, {})
      compareByVariant.get(row.variant_id)![row.region] = row.compare_at
    }
  }

  const stockByVariant = new Map<string, StockByRegion>()
  for (const row of stockRows) {
    if (!stockByVariant.has(row.variant_id)) stockByVariant.set(row.variant_id, emptyByRegion())
    stockByVariant.get(row.variant_id)![row.region] = row.quantity
  }

  const variantsByProduct = new Map<string, Variant[]>()
  for (const row of variantRows) {
    const variant: Variant = {
      id: row.id,
      sku: row.sku,
      label: row.label,
      options: JSON.parse(row.options) as VariantOptions,
      price: priceByVariant.get(row.id) ?? emptyByRegion(),
      compareAt: compareByVariant.get(row.id),
      stock: stockByVariant.get(row.id) ?? emptyByRegion(),
    }
    const list = variantsByProduct.get(row.product_id) ?? []
    list.push(variant)
    variantsByProduct.set(row.product_id, list)
  }

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    category: row.category as Category,
    badges: JSON.parse(row.badges) as string[],
    media: JSON.parse(row.media) as MediaItem[],
    specs: JSON.parse(row.specs) as { label: string; value: string }[],
    highlights: JSON.parse(row.highlights ?? '[]') as string[],
    rating:
      row.rating_average != null && row.rating_count != null
        ? { average: row.rating_average, count: row.rating_count }
        : null,
    featured: row.featured,
    weightGrams: row.weight_grams,
    variants: variantsByProduct.get(row.id) ?? [],
  }))
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

export function listProducts(filter: ListFilter): Product[] {
  const where: string[] = []
  const params: unknown[] = []

  if (filter.category && filter.category !== 'all') {
    where.push('category = ?')
    params.push(filter.category)
  }

  if (filter.search?.trim()) {
    where.push('(LOWER(name) LIKE ? OR LOWER(tagline) LIKE ? OR LOWER(description) LIKE ? OR category LIKE ?)')
    const needle = `%${filter.search.trim().toLowerCase()}%`
    params.push(needle, needle, needle, needle)
  }

  const sql =
    'SELECT * FROM products' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY featured DESC, name ASC'

  const rows = db().prepare(sql).all(...(params as never[])) as unknown as ProductRow[]
  let products = hydrate(rows)

  if (filter.inStockOnly) {
    products = products.filter((p) => p.variants.some((v) => v.stock[filter.region] > 0))
  }

  // Price sorts depend on which region is asking, so they are resolved
  // after the per-region prices have been assembled.
  const lowest = (p: Product) => Math.min(...p.variants.map((v) => v.price[filter.region]))
  switch (filter.sort) {
    case 'price-asc':
      products.sort((a, b) => lowest(a) - lowest(b))
      break
    case 'price-desc':
      products.sort((a, b) => lowest(b) - lowest(a))
      break
    case 'name':
      products.sort((a, b) => a.name.localeCompare(b.name))
      break
    default:
      break
  }

  return filter.limit ? products.slice(0, filter.limit) : products
}

export function getProductBySlug(slug: string): Product {
  const row = db().prepare('SELECT * FROM products WHERE slug = ?').get(slug) as
    | ProductRow
    | undefined
  if (!row) throw notFound('not_found', `No product with the slug "${slug}".`)
  return hydrate([row])[0]
}

export function getRelated(slug: string, region: RegionCode, limit = 4): Product[] {
  const target = db().prepare('SELECT id, category FROM products WHERE slug = ?').get(slug) as
    | { id: string; category: string }
    | undefined
  if (!target) return []

  const rows = db()
    .prepare(
      `SELECT * FROM products
       WHERE id != ?
       ORDER BY (category = ?) DESC, featured DESC
       LIMIT 24`,
    )
    .all(target.id, target.category) as unknown as ProductRow[]

  return hydrate(rows)
    .filter((p) => p.variants.some((v) => v.stock[region] > 0))
    .slice(0, limit)
}

export function getVariantsByIds(ids: string[]): Map<string, { variant: Variant; product: Product }> {
  const map = new Map<string, { variant: Variant; product: Product }>()
  if (ids.length === 0) return map

  const placeholders = ids.map(() => '?').join(',')
  const rows = db()
    .prepare(
      `SELECT DISTINCT p.* FROM products p
       JOIN variants v ON v.product_id = p.id
       WHERE v.id IN (${placeholders})`,
    )
    .all(...ids) as unknown as ProductRow[]

  for (const product of hydrate(rows)) {
    for (const variant of product.variants) {
      if (ids.includes(variant.id)) map.set(variant.id, { variant, product })
    }
  }
  return map
}

// ------------------------------------------------------------- promos

export function getPromo(code: string): Promo | null {
  const row = db()
    .prepare('SELECT * FROM promos WHERE code = ? AND active = 1')
    .get(code.trim().toUpperCase()) as
    | { code: string; label: string; percent_off: number; regions: string; min_subtotal: string }
    | undefined
  if (!row) return null
  return {
    code: row.code,
    label: row.label,
    percentOff: row.percent_off,
    regions: JSON.parse(row.regions) as RegionCode[],
    minSubtotal: JSON.parse(row.min_subtotal) as PriceByRegion,
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
 * Writes the order and decrements stock in a single transaction, with
 * the stock check inside it. Two people buying the last hoodie at the
 * same moment cannot both succeed: the UPDATE is guarded on quantity,
 * and a zero-row result rolls the whole thing back.
 */
export function createOrder(input: NewOrder): Order {
  const conn = db()

  if (input.idempotencyKey) {
    const existing = conn
      .prepare('SELECT number FROM orders WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as { number: string } | undefined
    if (existing) return getOrder(existing.number)
  }

  const number = generateOrderNumber(input.region)

  const decrement = conn.prepare(
    `UPDATE stock SET quantity = quantity - ?
     WHERE variant_id = ? AND region = ? AND quantity >= ?`,
  )
  const insertOrder = conn.prepare(`
    INSERT INTO orders (
      number, region, placed_at, status, payment_status, email, address, shipping,
      payment_method_id, payment_method_label, payment_reference, promo_code, totals, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertLine = conn.prepare(`
    INSERT INTO order_lines (
      order_number, product_id, product_name, variant_id, variant_label, sku, quantity, unit_price, line_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const placedAt = new Date().toISOString()

  conn.exec('BEGIN IMMEDIATE')
  try {
    for (const line of input.lines) {
      const result = decrement.run(line.quantity, line.variantId, input.region, line.quantity)
      if (result.changes === 0) {
        throw conflict(
          'out_of_stock',
          `${line.productName} (${line.variantLabel}) sold out while you were checking out.`,
        )
      }
    }

    insertOrder.run(
      number,
      input.region,
      placedAt,
      'confirmed',
      input.paymentStatus,
      input.email,
      JSON.stringify(input.address),
      JSON.stringify(input.shipping),
      input.paymentMethodId,
      input.paymentMethodLabel,
      input.paymentReference,
      input.promoCode,
      JSON.stringify(input.totals),
      input.idempotencyKey,
    )

    for (const line of input.lines) {
      insertLine.run(
        number,
        line.productId,
        line.productName,
        line.variantId,
        line.variantLabel,
        line.sku,
        line.quantity,
        line.unitPrice,
        line.lineTotal,
      )
    }

    conn.exec('COMMIT')
  } catch (err) {
    conn.exec('ROLLBACK')
    throw err
  }

  return getOrder(number)
}

type OrderRow = {
  number: string
  region: string
  placed_at: string
  status: string
  payment_status: string
  email: string
  address: string
  shipping: string
  payment_method_id: string
  payment_method_label: string
  payment_reference: string | null
  promo_code: string | null
  totals: string
}

function toOrder(row: OrderRow): Order {
  const lines = db()
    .prepare('SELECT * FROM order_lines WHERE order_number = ? ORDER BY id')
    .all(row.number) as unknown as {
    product_id: string
    product_name: string
    variant_label: string
    sku: string
    quantity: number
    unit_price: number
    line_total: number
  }[]

  return {
    number: row.number,
    region: row.region as RegionCode,
    placedAt: row.placed_at,
    status: row.status as Order['status'],
    paymentStatus: row.payment_status as Order['paymentStatus'],
    email: row.email,
    address: JSON.parse(row.address) as Address,
    shipping: JSON.parse(row.shipping) as ShippingQuote,
    paymentMethodId: row.payment_method_id,
    paymentMethodLabel: row.payment_method_label,
    promoCode: row.promo_code,
    totals: JSON.parse(row.totals) as OrderTotals,
    lines: lines.map((l) => ({
      productId: l.product_id,
      productName: l.product_name,
      variantLabel: l.variant_label,
      sku: l.sku,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      lineTotal: l.line_total,
    })),
  }
}

export function getOrder(number: string): Order {
  const row = db()
    .prepare('SELECT * FROM orders WHERE number = ?')
    .get(number.trim().toUpperCase()) as OrderRow | undefined
  if (!row) throw notFound('not_found', `We could not find order ${number}.`)
  return toOrder(row)
}

/**
 * Orders are only ever listed for a known email address. Without that
 * guard this endpoint would hand anyone the whole order book.
 */
export function listOrdersByEmail(region: RegionCode, email: string): Order[] {
  const rows = db()
    .prepare(
      'SELECT * FROM orders WHERE region = ? AND LOWER(email) = LOWER(?) ORDER BY placed_at DESC LIMIT 50',
    )
    .all(region, email.trim()) as unknown as OrderRow[]
  return rows.map(toOrder)
}

export function stats(): { products: number; variants: number; orders: number } {
  const one = (sql: string) => (db().prepare(sql).get() as { c: number }).c
  return {
    products: one('SELECT COUNT(*) AS c FROM products'),
    variants: one('SELECT COUNT(*) AS c FROM variants'),
    orders: one('SELECT COUNT(*) AS c FROM orders'),
  }
}

export { REGION_CODES }
