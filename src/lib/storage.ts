// localStorage that never throws. Private windows, disabled site data
// and quota errors all degrade to "no stored value" instead of taking a
// render down with them.

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable or full — the session still works in memory */
  }
}

export function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export const STORAGE_KEYS = {
  region: 'orbis.region.v1',
  cart: (region: string) => `orbis.cart.${region}.v1`,
  orders: 'orbis.orders.v1',
  promo: (region: string) => `orbis.promo.${region}.v1`,
  stock: 'orbis.stock.v1',
  recentlyViewed: (region: string) => `orbis.recent.${region}.v1`,
} as const
