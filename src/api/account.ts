import { ApiError } from './server'
import type { Order, Product } from '../types'
import type { RegionCode } from '../regions/config'

// ---------------------------------------------------------------------
// Shopper accounts and search.
//
// Kept apart from api/client.ts for the same reason api/admin.ts is: the
// storefront client has a mock fallback so the shop runs with no backend,
// and there is no sensible mock for "is this password right". These talk
// to the real API or they say so.
// ---------------------------------------------------------------------

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api'

const TOKEN_KEY = 'orbis.account.v1'

type Stored = { token: string; expiresAt: number }

export function getToken(): string | null {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const { token, expiresAt } = JSON.parse(raw) as Stored
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

export type Customer = { email: string; name: string; region: RegionCode | null }

type ErrorBody = { error?: { code?: string; message?: string } }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError('network', 'We could not reach the store. Check your connection and try again.')
  }

  // A 401 on anything but signing in means the session has lapsed, so drop
  // the dead token rather than leaving the UI to retry with it forever.
  if (response.status === 401 && !path.endsWith('/login') && !path.endsWith('/register')) {
    clearToken()
  }

  const body = (await response.json().catch(() => null)) as (T & ErrorBody) | null
  if (!response.ok) {
    throw new ApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? 'Something went wrong. Please try again.',
    )
  }
  if (body === null) {
    throw new ApiError('api_missing', 'The store could not be reached.')
  }
  return body as T
}

const json = (method: string, data?: unknown) => ({
  method,
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
})

export type SearchResult = {
  query: string
  exact: Product[]
  related: Product[]
  relatedReason: 'none' | 'partial' | 'popular'
}

export const accountApi = {
  async register(input: {
    email: string
    password: string
    name?: string
    region?: RegionCode
  }): Promise<Customer> {
    const r = await request<{ token: string; expiresAt: number; customer: Customer }>(
      '/account/register',
      json('POST', input),
    )
    setToken(r.token, r.expiresAt)
    return r.customer
  },

  async login(email: string, password: string): Promise<Customer> {
    const r = await request<{ token: string; expiresAt: number; customer: Customer }>(
      '/account/login',
      json('POST', { email, password }),
    )
    setToken(r.token, r.expiresAt)
    return r.customer
  },

  logout: clearToken,

  me: () => request<Customer>('/account/me'),

  orders: () => request<Order[]>('/account/orders'),
}

/** Search is public — no token, and it works signed out. */
export function search(region: RegionCode, q: string): Promise<SearchResult> {
  return request<SearchResult>(`/search?region=${region}&q=${encodeURIComponent(q)}`)
}
