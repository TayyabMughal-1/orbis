import { conflict, notFound } from './errors.js'
import { query, transaction, type PoolClient } from './db.js'
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
// Rows come back in the exact shapes the storefront already used, so
// swapping the database underneath changed nothing above this line.
//
// A product is spread across three tables (products, variants,
// variant_regions) but is only ever wanted whole, so every read here is
// a single joined query reassembled in JS rather than a query per
// variant. One round trip matters more than it would on a local
// database: the pooler is a network hop away.
// ---------------------------------------------------------------------

type ProductJoinRow = {
  id: string
  slug: string
  name: string
  tagline: string
  description: string
  highlights: string[]
  rating_average: string | null
  rating_count: number | null
  category: string
  badges: string[]
  media: unknown
  specs: unknown
  featured: number
  weight_grams: number
  collections: string[] | null
  v_id: string | null
  v_sku: string | null
  v_label: string | null
  v_options: unknown
  v_position: number | null
  region: string | null
  price: number | null
  compare_at: number | null
  stock: number | null
}

const PRODUCT_SELECT = `
  SELECT p.id, p.slug, p.name, p.tagline, p.description, p.highlights,
         p.rating_average, p.rating_count, p.category, p.badges,
         p.media, p.specs, p.featured, p.weight_grams,
         v.id AS v_id, v.sku AS v_sku, v.label AS v_label,
         v.options AS v_options, v.position AS v_position,
         vr.region, vr.price, vr.compare_at, vr.stock,
         COALESCE(
           (SELECT array_agg(pc.collection_id ORDER BY pc.collection_id)
              FROM product_collections pc WHERE pc.product_id = p.id),
           '{}'
         ) AS collections
    FROM products p
    LEFT JOIN variants v ON v.product_id = p.id
    LEFT JOIN variant_regions vr ON vr.variant_id = v.id`

/**
 * Folds the joined rows back into products. Rows arrive grouped by
 * product and ordered by variant position, so this only has to watch for
 * the id changing rather than sort anything itself.
 */
function assemble(rows: ProductJoinRow[]): Product[] {
  const byId = new Map<string, Product>()
  const variantsById = new Map<string, Map<string, Variant>>()

  for (const row of rows) {
    let product = byId.get(row.id)
    if (!product) {
      product = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        tagline: row.tagline,
        description: row.description,
        highlights: row.highlights ?? [],
        rating:
          row.rating_average === null
            ? null
            : { average: Number(row.rating_average), count: row.rating_count ?? 0 },
        category: row.category as Category,
        badges: row.badges ?? [],
        media: (row.media ?? []) as Product['media'],
        specs: (row.specs ?? []) as Product['specs'],
        featured: row.featured ?? 0,
        weightGrams: row.weight_grams ?? 0,
        collections: row.collections ?? [],
        variants: [],
      }
      byId.set(row.id, product)
      variantsById.set(row.id, new Map())
    }

    if (!row.v_id) continue
    const variants = variantsById.get(row.id) as Map<string, Variant>

    let variant = variants.get(row.v_id)
    if (!variant) {
      variant = {
        id: row.v_id,
        sku: row.v_sku ?? '',
        label: row.v_label ?? '',
        options: (row.v_options ?? {}) as Variant['options'],
        price: {} as PriceByRegion,
        compareAt: undefined,
        stock: {} as PriceByRegion,
      }
      variants.set(row.v_id, variant)
      product.variants.push(variant)
    }

    if (row.region) {
      ;(variant.price as Record<string, number>)[row.region] = row.price ?? 0
      ;(variant.stock as Record<string, number>)[row.region] = row.stock ?? 0
      if (row.compare_at !== null) {
        variant.compareAt = { ...(variant.compareAt ?? {}), [row.region]: row.compare_at }
      }
    }
  }

  return [...byId.values()]
}

async function loadProducts(where = '', params: unknown[] = []): Promise<Product[]> {
  const { rows } = await query<ProductJoinRow>(
    `${PRODUCT_SELECT} ${where} ORDER BY p.featured DESC, p.name, v.position`,
    params,
  )
  return assemble(rows)
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
  const clauses: string[] = []
  const params: unknown[] = []

  if (filter.category && filter.category !== 'all') {
    params.push(filter.category)
    clauses.push(`p.category = $${params.length}`)
  }

  if (filter.search?.trim()) {
    // Escaped so a customer typing "%" or "_" searches for those
    // characters rather than turning them into wildcards.
    const needle = filter.search.trim().replace(/[\\%_]/g, '\\$&')
    params.push(`%${needle}%`)
    const p = `$${params.length}`
    clauses.push(
      `(p.name ILIKE ${p} OR p.tagline ILIKE ${p} OR p.description ILIKE ${p} OR p.category ILIKE ${p})`,
    )
  }

  let rows = await loadProducts(clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params)

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
  const [product] = await loadProducts('WHERE p.slug = $1', [slug])
  if (!product) throw notFound('not_found', `No product with the slug "${slug}".`)
  return product
}

export async function getRelated(slug: string, region: RegionCode, limit = 4): Promise<Product[]> {
  const target = await query<{ id: string; category: string }>(
    'SELECT id, category FROM products WHERE slug = $1',
    [slug],
  )
  if (target.rowCount === 0) return []
  const { id, category } = target.rows[0]

  const rows = await loadProducts('WHERE p.id <> $1', [id])

  return rows
    // Same department first, then anything else that is actually buyable.
    .sort((a, b) => Number(b.category === category) - Number(a.category === category))
    .filter((p) => p.variants.some((v) => v.stock[region] > 0))
    .slice(0, limit)
}

export async function getVariantsByIds(
  ids: string[],
): Promise<Map<string, { variant: Variant; product: Product }>> {
  const map = new Map<string, { variant: Variant; product: Product }>()
  if (ids.length === 0) return map

  // Load whole products for the variants asked about — the caller needs
  // the product alongside each variant for the order line snapshot.
  const rows = await loadProducts(
    'WHERE p.id IN (SELECT product_id FROM variants WHERE id = ANY($1))',
    [ids],
  )

  for (const product of rows) {
    for (const variant of product.variants) {
      if (ids.includes(variant.id)) map.set(variant.id, { variant, product })
    }
  }
  return map
}

// ------------------------------------------------------------- promos

export async function getPromo(code: string): Promise<Promo | null> {
  const { rows } = await query<{
    code: string
    label: string
    percent_off: number
    regions: string[]
    min_subtotal: unknown
  }>('SELECT * FROM promos WHERE code = $1 AND active', [code.trim().toUpperCase()])

  const row = rows[0]
  if (!row) return null
  return {
    code: row.code,
    label: row.label,
    percentOff: row.percent_off,
    regions: row.regions as RegionCode[],
    minSubtotal: (row.min_subtotal ?? {}) as PriceByRegion,
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
 * The guard lives in the WHERE clause: a variant's regional stock row
 * only matches while it still holds enough, so two people buying the
 * last item cannot both succeed — the loser's UPDATE touches no rows and
 * the whole transaction rolls back.
 */
export async function createOrder(input: NewOrder): Promise<Order> {
  if (input.idempotencyKey) {
    const existing = await query<{ number: string }>(
      'SELECT number FROM orders WHERE idempotency_key = $1',
      [input.idempotencyKey],
    )
    if (existing.rowCount) return getOrder(existing.rows[0].number)
  }

  const number = generateOrderNumber(input.region)

  await transaction(async (client: PoolClient) => {
    for (const line of input.lines) {
      const result = await client.query(
        `UPDATE variant_regions SET stock = stock - $1
          WHERE variant_id = $2 AND region = $3 AND stock >= $1`,
        [line.quantity, line.variantId, input.region],
      )

      if (result.rowCount !== 1) {
        throw conflict(
          'out_of_stock',
          `${line.productName} (${line.variantLabel}) sold out while you were checking out.`,
        )
      }
    }

    await client.query(
      `INSERT INTO orders (number, region, placed_at, status, payment_status, email,
                           address, shipping, payment_method_id, payment_method_label,
                           payment_reference, promo_code, totals, idempotency_key)
       VALUES ($1,$2,now(),'confirmed',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        number,
        input.region,
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
      ],
    )

    let position = 0
    for (const line of input.lines) {
      await client.query(
        `INSERT INTO order_lines (order_number, position, product_id, product_name,
                                  variant_id, variant_label, sku, quantity, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          number,
          position,
          line.productId,
          line.productName,
          line.variantId,
          line.variantLabel,
          line.sku,
          line.quantity,
          line.unitPrice,
          line.lineTotal,
        ],
      )
      position += 1
    }
  })

  return getOrder(number)
}

type OrderRow = {
  number: string
  region: string
  placed_at: Date
  status: string
  payment_status: string
  email: string
  address: unknown
  shipping: unknown
  payment_method_id: string
  payment_method_label: string
  payment_reference: string | null
  promo_code: string | null
  totals: unknown
  lines: unknown
}

const ORDER_SELECT = `
  SELECT o.*,
         COALESCE(
           (SELECT json_agg(l ORDER BY l.position)
              FROM order_lines l WHERE l.order_number = o.number),
           '[]'::json
         ) AS lines
    FROM orders o`

type LineRow = {
  product_id: string
  product_name: string
  variant_label: string
  sku: string
  quantity: number
  unit_price: number
  line_total: number
}

function toOrder(row: OrderRow): Order {
  return {
    number: row.number,
    region: row.region as RegionCode,
    placedAt: new Date(row.placed_at).toISOString(),
    status: row.status as Order['status'],
    paymentStatus: row.payment_status as Order['paymentStatus'],
    email: row.email,
    address: row.address as Address,
    shipping: row.shipping as ShippingQuote,
    paymentMethodId: row.payment_method_id,
    paymentMethodLabel: row.payment_method_label,
    promoCode: row.promo_code,
    totals: row.totals as OrderTotals,
    lines: ((row.lines ?? []) as LineRow[]).map((l) => ({
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

/**
 * The order a previous request with this Idempotency-Key created, if
 * there is one. Checked before anything else the checkout route does.
 */
export async function getOrderByIdempotencyKey(key: string): Promise<Order | null> {
  const { rows } = await query<OrderRow>(`${ORDER_SELECT} WHERE o.idempotency_key = $1`, [key])
  return rows.length > 0 ? toOrder(rows[0]) : null
}

export async function getOrder(number: string): Promise<Order> {
  const { rows } = await query<OrderRow>(`${ORDER_SELECT} WHERE o.number = $1`, [
    number.trim().toUpperCase(),
  ])
  if (rows.length === 0) throw notFound('not_found', `We could not find order ${number}.`)
  return toOrder(rows[0])
}

/** Only ever listed for a known email — otherwise this hands out the book. */
export async function listOrdersByEmail(region: RegionCode, email: string): Promise<Order[]> {
  const { rows } = await query<OrderRow>(
    `${ORDER_SELECT} WHERE o.region = $1 AND lower(o.email) = lower($2)
      ORDER BY o.placed_at DESC LIMIT 50`,
    [region, email.trim()],
  )
  return rows.map(toOrder)
}

export { toOrder, type OrderRow, ORDER_SELECT }

/**
 * Every order for an address, across all three stores.
 *
 * listOrdersByEmail is scoped to one region because the storefront's
 * lookup page is; an account is not, so someone who ordered in one store
 * and now browses another still sees their history.
 */
export async function listOrdersForEmail(email: string): Promise<Order[]> {
  const { rows } = await query<OrderRow>(
    `${ORDER_SELECT} WHERE lower(o.email) = lower($1) ORDER BY o.placed_at DESC LIMIT 100`,
    [email.trim()],
  )
  return rows.map(toOrder)
}

// ------------------------------------------------------------- search

export type SearchResult = {
  query: string
  /** Products that actually matched the phrase. */
  exact: Product[]
  /**
   * What to offer when `exact` is empty: products matching any single word
   * of the query, and failing that the best sellers. Never empty on a
   * stocked catalogue, so a search always has somewhere to go.
   */
  related: Product[]
  /** Why `related` is what it is, so the page can word itself honestly. */
  relatedReason: 'none' | 'partial' | 'popular'
}

/**
 * Search with a fallback, rather than a dead end.
 *
 * A shop that answers "no results" and stops has lost the sale. Three
 * passes, narrow to broad:
 *
 *   1. the whole phrase, which is what listProducts already does;
 *   2. any single word of it — "brass lamp" finds the lamps and the brass
 *      things even when nothing is both;
 *   3. best sellers, so the page always has something to show.
 */
export async function searchProducts(
  region: RegionCode,
  raw: string,
  limit = 24,
): Promise<SearchResult> {
  const q = raw.trim()
  if (!q) return { query: q, exact: [], related: [], relatedReason: 'none' }

  const exact = await listProducts({ region, search: q, limit })
  if (exact.length > 0) return { query: q, exact, related: [], relatedReason: 'none' }

  // Words worth matching on their own. One- and two-letter fragments match
  // most of the catalogue and would make the suggestions meaningless.
  const words = q
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length >= 3)

  if (words.length > 0) {
    const params: unknown[] = []
    const clauses = words.map((w) => {
      params.push(`%${w.replace(/[\%_]/g, '\$&')}%`)
      const p = `$${params.length}`
      return `(p.name ILIKE ${p} OR p.tagline ILIKE ${p} OR p.description ILIKE ${p} OR p.category ILIKE ${p})`
    })
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM products p WHERE ${clauses.join(' OR ')} LIMIT $${params.length + 1}`,
      [...params, limit],
    )
    if (rows.length > 0) {
      const ids = new Set(rows.map((r) => r.id))
      const all = await listProducts({ region })
      const related = all.filter((p) => ids.has(p.id)).slice(0, limit)
      if (related.length > 0) return { query: q, exact: [], related, relatedReason: 'partial' }
    }
  }

  const popular = await listProducts({ region, sort: 'featured', inStockOnly: true, limit: 8 })
  return { query: q, exact: [], related: popular, relatedReason: 'popular' }
}
