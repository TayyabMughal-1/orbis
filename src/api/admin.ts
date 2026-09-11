import { ApiError } from './server'
import type { RegionCode } from '../regions/config'
import type { Order, Product, Promo } from '../types'

// ---------------------------------------------------------------------
// Admin API client.
//
// Separate from api/client.ts on purpose: the storefront client has a
// mock fallback so the shop runs with no backend, but there is no
// sensible mock for "save this price" — it either persists or it does
// not. So the dashboard talks to the real API or it does not work, and
// says so plainly when the API is not configured.
// ---------------------------------------------------------------------

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api'

const TOKEN_KEY = 'orbis.admin.token.v1'

export function getToken(): string | null {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: number }
    if (Date.now() >= expiresAt) {
      window.localStorage.removeItem(TOKEN_KEY)
      return null
    }
    return token
  } catch {
    return null
  }
}

function setToken(token: string, expiresAt: number): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt }))
  } catch {
    /* private window — the session just will not survive a reload */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/** Thrown when the token is missing or expired, so the UI can bounce to login. */
export class UnauthorizedError extends ApiError {
  constructor() {
    super('unauthorized', 'Your session has expired. Please sign in again.')
  }
}

type RequestOptions = {
  /**
   * Treat a 401 as a plain error rather than an expired session.
   *
   * Only login needs this. Everywhere else a 401 genuinely means the
   * token has gone stale, but on login it means the password was wrong —
   * and telling someone their session expired when they simply mistyped
   * is worse than saying nothing.
   */
  rawAuthErrors?: boolean
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(
      'network',
      'Could not reach the API. Is it running, and is VITE_API_URL pointing at it?',
    )
  }

  if (response.status === 401 && !options.rawAuthErrors) {
    clearToken()
    throw new UnauthorizedError()
  }

  const body = (await response.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string } })
    | null

  if (!response.ok) {
    // A JSON error from our own API is always the most useful thing to
    // show, so prefer it.
    if (body?.error?.message) {
      throw new ApiError(body.error.code ?? `http_${response.status}`, body.error.message)
    }

    // No JSON body means the request never reached the API — typically a
    // dev-server proxy returning its own HTML error page because nothing
    // is listening on the other end. "That did not work" is useless
    // there; say what is actually wrong and what to do about it.
    // Our API always answers with a JSON error, so a 5xx carrying no
    // JSON at all cannot have come from it — it is the proxy in front
    // reporting that nothing is listening. Vite's dev server uses 500
    // for that, others use 502/504; the cause is the same.
    if (response.status >= 500) {
      throw new ApiError(
        'api_unreachable',
        'The API is not responding. Start it with `npm run dev:all` (or `npm run api`), then try again.',
      )
    }

    throw new ApiError(`http_${response.status}`, `The API returned an error (HTTP ${response.status}).`)
  }

  return body as T
}

/**
 * Is the API actually up?
 *
 * The login screen asks before the operator types anything, so "nothing
 * is running" is spotted up front rather than being mistaken for a
 * rejected password.
 */
export async function apiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`)
    return res.ok
  } catch {
    return false
  }
}

const json = (method: string, data?: unknown) => ({
  method,
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
})

// ---------------------------------------------------------------- types

export type AdminPromo = Promo & { active: boolean }

export type ShippingSetting = {
  id: string
  label: string
  eta: string
  amount: number
  freeOver: number | null
}

export type RegionSettings = {
  promoStrip?: string
  heroEyebrow?: string
  heroTitle?: string
  heroBody?: string
  supportEmail?: string
  supportPhone?: string
  taxRate?: number
  shipping?: ShippingSetting[]
}

export type ProductPayload = Omit<Product, 'rating'> & {
  rating: { average: number; count: number } | null
}

// ------------------------------------------------------------- the api

export const adminApi = {
  async login(password: string): Promise<void> {
    const result = await request<{ token: string; expiresAt: number }>(
      '/admin/login',
      json('POST', { password }),
      { rawAuthErrors: true },
    )
    setToken(result.token, result.expiresAt)
  },

  logout: clearToken,

  session: () => request<{ ok: true; products: number; variants: number; orders: number }>('/admin/session'),

  listProducts: () => request<Product[]>('/admin/products'),
  getProduct: (slug: string) => request<Product>(`/admin/products/${encodeURIComponent(slug)}`),
  createProduct: (product: ProductPayload) => request<Product>('/admin/products', json('POST', product)),
  updateProduct: (id: string, product: ProductPayload) =>
    request<Product>(`/admin/products/${encodeURIComponent(id)}`, json('PUT', product)),
  deleteProduct: (id: string) =>
    request<{ ok: true }>(`/admin/products/${encodeURIComponent(id)}`, json('DELETE')),

  listPromos: () => request<AdminPromo[]>('/admin/promos'),
  savePromo: (promo: AdminPromo) => request<AdminPromo>('/admin/promos', json('POST', promo)),
  deletePromo: (code: string) =>
    request<{ ok: true }>(`/admin/promos/${encodeURIComponent(code)}`, json('DELETE')),

  listOrders: () => request<Order[]>('/admin/orders'),
  updateOrder: (number: string, patch: { status?: string; paymentStatus?: string }) =>
    request<Order>(`/admin/orders/${encodeURIComponent(number)}`, json('PATCH', patch)),

  getSettings: (region: RegionCode) => request<RegionSettings>(`/admin/settings/${region}`),
  putSettings: (region: RegionCode, settings: RegionSettings) =>
    request<RegionSettings>(`/admin/settings/${region}`, json('PUT', settings)),
}
