import * as mock from './server'
import { ApiError } from './server'
import type { RegionCode } from '../regions/config'
import type { Order, Product } from '../types'
import type {
  CreateOrderRequest,
  ListQuery,
  PromoResult,
  Quote,
  QuoteRequest,
} from './server'

// ---------------------------------------------------------------------
// The one seam between the storefront and the backend.
//
// Every component calls `api.*` and nothing else. There are two
// implementations behind it:
//
//   • HTTP  — the real service in server/, used whenever VITE_API_URL is
//             set (in dev, "/api" via the Vite proxy).
//   • Mock  — the in-browser catalogue in ./server.ts, used when it is
//             not, so the storefront still runs standalone with no
//             backend at all.
//
// Both satisfy the same StoreApi type, so a component cannot tell which
// one it is talking to.
//
// A note on trust that applies to both: requests carry line ids and
// quantities, never prices. The server prices the order. Keep it that
// way.
// ---------------------------------------------------------------------

export { ApiError }
export type { ListQuery, Quote, QuoteRequest, CreateOrderRequest, PromoResult, SortKey } from './server'

export type StoreApi = {
  listProducts(query: ListQuery): Promise<Product[]>
  getProduct(slug: string): Promise<Product>
  getRelated(slug: string, region: RegionCode): Promise<Product[]>
  validatePromo(code: string, region: RegionCode, subtotal: number): Promise<PromoResult>
  quote(request: QuoteRequest): Promise<Quote>
  createOrder(request: CreateOrderRequest & { idempotencyKey?: string }): Promise<Order>
  getOrder(number: string): Promise<Order>
  listOrders(region: RegionCode, email: string): Promise<Order[]>
}

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')

export const usingLiveApi = Boolean(API_URL)

// ---------------------------------------------------------------- http

type ErrorBody = { error?: { code?: string; message?: string } }

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    // Offline, DNS failure, server down — none of which the customer can
    // act on beyond trying again.
    throw new ApiError('network', 'We could not reach the store. Check your connection and try again.')
  }

  if (response.status === 204) return undefined as T

  const body = (await response.json().catch(() => null)) as (T & ErrorBody) | null

  if (!response.ok) {
    throw new ApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? 'Something went wrong. Please try again.',
    )
  }

  // A 200 that is not JSON means VITE_API_URL points somewhere that is
  // not this API — typically a static host answering every path with
  // index.html. Returning null here would leave the shop looking empty
  // with nothing explaining why, so fail loudly instead.
  if (body === null) {
    throw new ApiError(
      'api_missing',
      'The store could not be loaded. VITE_API_URL does not appear to point at the Orbis API.',
    )
  }

  return body as T
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

/** Only ids and quantities travel to the server — never prices. */
const toWireLines = (lines: QuoteRequest['lines']) =>
  lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity }))

const httpApi: StoreApi = {
  listProducts: (q) =>
    http<Product[]>(
      `/products${query({
        region: q.region,
        category: q.category,
        sort: q.sort,
        search: q.search,
        inStockOnly: q.inStockOnly,
        from: q.origin,
        limit: q.limit,
      })}`,
    ),

  getProduct: (slug) => http<Product>(`/products/${encodeURIComponent(slug)}`),

  getRelated: (slug, region) =>
    http<Product[]>(`/products/${encodeURIComponent(slug)}/related${query({ region })}`),

  validatePromo: (code, region, subtotal) =>
    http<PromoResult>('/promos/validate', {
      method: 'POST',
      body: JSON.stringify({ code, region, subtotal }),
    }),

  quote: (request) =>
    http<Quote>('/quote', {
      method: 'POST',
      body: JSON.stringify({ ...request, lines: toWireLines(request.lines) }),
    }),

  createOrder: ({ idempotencyKey, ...request }) =>
    http<Order>('/orders', {
      method: 'POST',
      // Lets a retry after a dropped response return the original order
      // rather than placing a second one.
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      body: JSON.stringify({ ...request, lines: toWireLines(request.lines) }),
    }),

  getOrder: (number) => http<Order>(`/orders/${encodeURIComponent(number)}`),

  listOrders: (region, email) => http<Order[]>(`/orders${query({ region, email })}`),
}

// ---------------------------------------------------------------- mock

const mockApi: StoreApi = {
  listProducts: mock.listProducts,
  getProduct: mock.getProduct,
  getRelated: mock.getRelated,
  validatePromo: mock.validatePromo,
  quote: mock.quote,
  createOrder: ({ idempotencyKey: _idempotencyKey, ...request }) => mock.createOrder(request),
  getOrder: mock.getOrder,
  listOrders: mock.listOrders,
}

export const api: StoreApi = API_URL ? httpApi : mockApi

/** Turns any thrown value into a message worth showing a customer. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}
