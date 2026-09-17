import { PRODUCTS, PROMOS, findProductBySlug } from './db'
import { REGIONS, type RegionCode } from '../regions/config'
import { computeTotals, shippingQuotesFor } from '../lib/pricing'
import { STORAGE_KEYS, readJson, writeJson } from '../lib/storage'
import type {
  Address,
  CartLine,
  Category,
  Order,
  OrderLineSnapshot,
  OrderTotals,
  Product,
  ShippingQuote,
  StockByRegion,
  Variant,
} from '../types'

// ---------------------------------------------------------------------
// The mock server.
//
// It behaves like a backend rather than a fixture: stock is finite and
// decrements on purchase, prices are recalculated server-side at quote
// and order time (never trusted from the client), promos are validated
// against the region and the subtotal, and orders are persisted.
//
// State lives in localStorage so a reload does not resurrect sold-out
// stock. Replace this file with real HTTP handlers and api/client.ts is
// the only other thing that changes.
// ---------------------------------------------------------------------

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
  }
}

const LATENCY_MS = { fast: 120, normal: 320, slow: 620 }

function delay<T>(value: T, ms = LATENCY_MS.normal): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// ------------------------------------------------------------- stock

type StockTable = Record<string, StockByRegion>

let stockTable: StockTable | null = null

function seedStock(): StockTable {
  const seeded: StockTable = {}
  for (const product of PRODUCTS) {
    for (const variant of product.variants) {
      seeded[variant.id] = { ...variant.stock }
    }
  }
  return seeded
}

function getStockTable(): StockTable {
  if (stockTable) return stockTable
  const seeded = seedStock()
  const stored = readJson<StockTable>(STORAGE_KEYS.stock, {})
  // Merge so newly added catalogue variants appear without wiping the
  // stock levels of the ones a visitor has already bought from.
  for (const [id, levels] of Object.entries(stored)) {
    if (seeded[id]) seeded[id] = levels
  }
  stockTable = seeded
  return stockTable
}

function persistStock(): void {
  if (stockTable) writeJson(STORAGE_KEYS.stock, stockTable)
}

export function stockFor(variantId: string, region: RegionCode): number {
  return getStockTable()[variantId]?.[region] ?? 0
}

/** Product with live stock levels folded into its variants. */
function withLiveStock(product: Product): Product {
  const table = getStockTable()
  return {
    ...product,
    variants: product.variants.map((v) => ({ ...v, stock: table[v.id] ?? v.stock })),
  }
}

function inStockAnywhere(product: Product, region: RegionCode): boolean {
  return product.variants.some((v) => stockFor(v.id, region) > 0)
}

// ---------------------------------------------------------- catalogue

export type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'name'

export type ListQuery = {
  region: RegionCode
  category?: Category | 'all'
  sort?: SortKey
  search?: string
  inStockOnly?: boolean
  limit?: number
  /** Only local stock, or only imports. */
  origin?: 'local' | 'import'
}

function lowestPrice(product: Product, region: RegionCode): number {
  return Math.min(...product.variants.map((v) => v.price[region]))
}

export async function listProducts(query: ListQuery): Promise<Product[]> {
  const { region, category = 'all', sort = 'featured', search, inStockOnly, origin, limit } = query

  let rows = PRODUCTS.map(withLiveStock)

  if (category !== 'all') rows = rows.filter((prod) => prod.category === category)

  if (origin) rows = rows.filter((prod) => (prod.origin ?? 'local') === origin)

  if (search && search.trim()) {
    const needle = search.trim().toLowerCase()
    rows = rows.filter((prod) =>
      [prod.name, prod.tagline, prod.description, prod.category]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }

  if (inStockOnly) rows = rows.filter((prod) => inStockAnywhere(prod, region))

  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case 'price-asc':
        return lowestPrice(a, region) - lowestPrice(b, region)
      case 'price-desc':
        return lowestPrice(b, region) - lowestPrice(a, region)
      case 'name':
        return a.name.localeCompare(b.name)
      default:
        return (b.featured ?? 0) - (a.featured ?? 0)
    }
  })

  return delay(limit ? sorted.slice(0, limit) : sorted, LATENCY_MS.normal)
}

export async function getProduct(slug: string): Promise<Product> {
  const product = findProductBySlug(slug)
  if (!product) throw new ApiError('not_found', `No product with the slug "${slug}".`)
  return delay(withLiveStock(product), LATENCY_MS.fast)
}

export async function getRelated(slug: string, region: RegionCode): Promise<Product[]> {
  const product = findProductBySlug(slug)
  if (!product) return delay([], LATENCY_MS.fast)
  const sameCategory = PRODUCTS.filter((p) => p.id !== product.id && p.category === product.category)
  const fillers = PRODUCTS.filter((p) => p.id !== product.id && p.category !== product.category)
  const picks = [...sameCategory, ...fillers]
    .filter((p) => inStockAnywhere(p, region))
    .slice(0, 4)
    .map(withLiveStock)
  return delay(picks, LATENCY_MS.fast)
}

// -------------------------------------------------------------- cart

export type ResolvedCartLine = {
  line: CartLine
  product: Product
  variant: Variant
  unitPrice: number
  lineTotal: number
  stock: number
}

/**
 * Joins stored cart lines against the live catalogue. Lines whose
 * product or variant no longer exists are dropped rather than throwing —
 * a stale cart should never block a visitor from shopping.
 */
export function resolveLines(lines: CartLine[], region: RegionCode): ResolvedCartLine[] {
  const resolved: ResolvedCartLine[] = []
  for (const line of lines) {
    const product = PRODUCTS.find((p) => p.id === line.productId)
    if (!product) continue
    const variant = product.variants.find((v) => v.id === line.variantId)
    if (!variant) continue
    const unitPrice = variant.price[region]
    resolved.push({
      line,
      product: withLiveStock(product),
      variant: { ...variant, stock: getStockTable()[variant.id] ?? variant.stock },
      unitPrice,
      lineTotal: unitPrice * line.quantity,
      stock: stockFor(variant.id, region),
    })
  }
  return resolved
}

// ------------------------------------------------------------- promos

export type PromoResult = {
  code: string
  label: string
  percentOff: number
}

export async function validatePromo(
  code: string,
  region: RegionCode,
  subtotal: number,
): Promise<PromoResult> {
  const normalized = code.trim().toUpperCase()
  const promo = PROMOS.find((pr) => pr.code === normalized)

  if (!promo) throw new ApiError('promo_invalid', `"${normalized}" is not a code we recognise.`)
  if (!promo.regions.includes(region)) {
    throw new ApiError('promo_region', `"${normalized}" is not valid in the ${REGIONS[region].country} store.`)
  }
  const min = promo.minSubtotal[region]
  if (subtotal < min) {
    throw new ApiError('promo_minimum', `"${normalized}" needs a larger order to apply.`)
  }
  return delay({ code: promo.code, label: promo.label, percentOff: promo.percentOff }, LATENCY_MS.fast)
}

// -------------------------------------------------------------- quote

export type QuoteRequest = {
  region: RegionCode
  lines: CartLine[]
  shippingId?: string
  paymentMethodId?: string
  promoCode?: string | null
  /** Ship-to state / emirate / province, for regional tax rates. */
  subRegion?: string
}

export type Quote = {
  lines: OrderLineSnapshot[]
  shippingOptions: ShippingQuote[]
  selectedShipping: ShippingQuote
  totals: OrderTotals
  promo: PromoResult | null
  promoError: string | null
}

export async function quote(req: QuoteRequest): Promise<Quote> {
  const config = REGIONS[req.region]
  const resolved = resolveLines(req.lines, req.region)

  const snapshots: OrderLineSnapshot[] = resolved.map((r) => ({
    productId: r.product.id,
    productName: r.product.name,
    variantLabel: r.variant.label,
    sku: r.variant.sku,
    quantity: r.line.quantity,
    unitPrice: r.unitPrice,
    lineTotal: r.lineTotal,
  }))

  const subtotal = snapshots.reduce((sum, l) => sum + l.lineTotal, 0)

  // Promo is re-checked here rather than trusted from the client.
  let promo: PromoResult | null = null
  let promoError: string | null = null
  if (req.promoCode) {
    try {
      promo = await validatePromo(req.promoCode, req.region, subtotal)
    } catch (err) {
      promoError = err instanceof ApiError ? err.message : 'That code could not be applied.'
    }
  }

  const discountedSubtotal = promo ? subtotal - Math.round(subtotal * (promo.percentOff / 100)) : subtotal
  // Mirrors the server: any imported line and the whole basket quotes
  // the import tiers. The mock and the real service share the pricing
  // function precisely so these cannot disagree.
  const hasImported = req.lines.some(
    (line) => PRODUCTS.find((p) => p.id === line.productId)?.origin === 'import',
  )
  const shippingOptions = shippingQuotesFor(config, discountedSubtotal, hasImported)
  const selectedShipping =
    shippingOptions.find((o) => o.id === req.shippingId) ?? shippingOptions[0]

  const method = config.paymentMethods.find((m) => m.id === req.paymentMethodId)
  const surcharge = method?.surcharge ?? 0

  const totals = computeTotals({
    config,
    subtotal,
    shipping: selectedShipping.amount,
    discountPercent: promo?.percentOff ?? 0,
    surcharge,
    subRegion: req.subRegion,
  })

  return delay({ lines: snapshots, shippingOptions, selectedShipping, totals, promo, promoError }, LATENCY_MS.fast)
}

// ------------------------------------------------------------- orders

export type CreateOrderRequest = QuoteRequest & {
  address: Address
  paymentMethodId: string
}

function readOrders(): Order[] {
  return readJson<Order[]>(STORAGE_KEYS.orders, [])
}

function orderNumber(region: RegionCode): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let tail = ''
  for (let i = 0; i < 6; i += 1) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `ORB-${region.toUpperCase()}-${tail}`
}

export async function createOrder(req: CreateOrderRequest): Promise<Order> {
  const config = REGIONS[req.region]

  if (!req.lines.length) throw new ApiError('cart_empty', 'There is nothing in your cart.')

  // Re-check stock at the moment of purchase — the cart may have sat
  // open while another order took the last unit.
  const resolved = resolveLines(req.lines, req.region)
  if (resolved.length !== req.lines.length) {
    throw new ApiError('line_unavailable', 'One of the items in your cart is no longer available.')
  }
  for (const r of resolved) {
    if (r.line.quantity > r.stock) {
      throw new ApiError(
        'out_of_stock',
        `Only ${r.stock} left of ${r.product.name} (${r.variant.label}) in the ${config.country} store.`,
      )
    }
  }

  const method = config.paymentMethods.find((m) => m.id === req.paymentMethodId)
  if (!method) throw new ApiError('payment_invalid', 'That payment method is not available in this store.')

  const priced = await quote(req)

  // ------------------------------------------------------------------
  // PAYMENT
  //
  // This is where a real integration goes, and it belongs on a server —
  // never in the browser, because it needs a secret key:
  //   us: Stripe PaymentIntent / PayPal order capture
  //   ae: Network International, Telr or Checkout.com; Tabby & Tamara
  //       are separate redirect flows that call you back on approval
  //   pk: Easypaisa / JazzCash merchant APIs, or bank transfer + manual
  //       reconciliation; COD needs no gateway at all
  //
  // Until then the order is recorded as confirmed and, for the offline
  // methods (COD, bank transfer), that is genuinely the whole flow.
  // ------------------------------------------------------------------

  const table = getStockTable()
  for (const r of resolved) {
    const levels = table[r.variant.id]
    if (levels) levels[req.region] = Math.max(0, levels[req.region] - r.line.quantity)
  }
  persistStock()

  // Mirrors server/src/payments.ts: methods that settle offline are
  // genuinely complete, everything else is recorded but not charged.
  const offline = method.id === 'cod' || method.id === 'bank'

  const order: Order = {
    number: orderNumber(req.region),
    region: req.region,
    placedAt: new Date().toISOString(),
    status: 'confirmed',
    paymentStatus: offline ? 'due_on_delivery' : 'pending',
    email: req.address.email,
    address: req.address,
    shipping: priced.selectedShipping,
    paymentMethodId: method.id,
    paymentMethodLabel: method.label,
    promoCode: priced.promo?.code ?? null,
    lines: priced.lines,
    totals: priced.totals,
  }

  const orders = readOrders()
  orders.unshift(order)
  writeJson(STORAGE_KEYS.orders, orders.slice(0, 50))

  return delay(order, LATENCY_MS.slow)
}

export async function getOrder(number: string): Promise<Order> {
  const order = readOrders().find((o) => o.number === number.toUpperCase())
  if (!order) throw new ApiError('not_found', `We could not find order ${number}.`)
  return delay(order, LATENCY_MS.fast)
}

/**
 * Takes an email like the real API does, so a component written against
 * one works unchanged against the other. The live service needs it
 * because without it the endpoint would hand out the whole order book.
 */
export async function listOrders(region: RegionCode, email?: string): Promise<Order[]> {
  const needle = email?.trim().toLowerCase()
  const rows = readOrders().filter(
    (o) => o.region === region && (!needle || o.email.toLowerCase() === needle),
  )
  return delay(rows, LATENCY_MS.fast)
}
