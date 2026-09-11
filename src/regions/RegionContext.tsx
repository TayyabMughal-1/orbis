import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { REGIONS, type RegionCode, type RegionConfig } from './config'
import { STORAGE_KEYS, writeString } from '../lib/storage'
import { usingLiveApi } from '../api/client'

type RegionContextValue = {
  region: RegionCode
  config: RegionConfig
  /** Switch storefront, staying on the equivalent page. */
  setRegion: (next: RegionCode) => void
  /** Prefixes an in-store path with the active region: "/cart" -> "/ae/cart". */
  href: (path: string) => string
}

const RegionContext = createContext<RegionContextValue | null>(null)

// ---------------------------------------------------------------------
// Editable settings
//
// The dashboard can override a store's promo strip, hero copy, support
// details, tax rate and delivery prices. Those live in the database, so
// the storefront fetches them and merges them over the compiled-in
// defaults from config.ts.
//
// Two things make this safe to do after first paint:
//   • the defaults are already correct, so nothing is blank while it
//     loads — the copy just updates if an override exists
//   • the server prices every order against the same overrides, so a
//     stale tab cannot check out at yesterday's tax rate
// ---------------------------------------------------------------------

type PublicSettings = {
  promoStrip?: string
  heroEyebrow?: string
  supportEmail?: string
  supportPhone?: string
  taxRate?: number
  shipping?: { id: string; label: string; eta: string; amount: number; freeOver: number | null }[]
}

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

function merge(base: RegionConfig, overrides: PublicSettings | null): RegionConfig {
  if (!overrides) return base

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
            etaDays: original?.etaDays ?? [2, 5],
            amount: tier.amount,
            ...(tier.freeOver != null ? { freeOver: tier.freeOver } : {}),
          }
        })
      : base.shipping,
  }
}

export function RegionProvider({ region, children }: { region: RegionCode; children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [overrides, setOverrides] = useState<PublicSettings | null>(null)

  useEffect(() => {
    // Nothing to fetch when the shop is running on its built-in
    // catalogue — there is no database holding overrides.
    if (!usingLiveApi) return

    let alive = true
    fetch(`${API_URL}/settings?region=${region}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PublicSettings | null) => {
        if (alive) setOverrides(data)
      })
      .catch(() => {
        // Offline or the API is down: the compiled-in defaults are still
        // correct and already on screen, so there is nothing to report.
      })

    return () => {
      alive = false
    }
  }, [region])

  const href = useCallback(
    (path: string) => {
      const clean = path.startsWith('/') ? path : `/${path}`
      return `/${region}${clean === '/' ? '' : clean}`
    },
    [region],
  )

  const setRegion = useCallback(
    (next: RegionCode) => {
      if (next === region) return
      // Remember the choice so the visitor is never re-detected against
      // their will on the next visit.
      writeString(STORAGE_KEYS.region, next)

      // Keep them on the same page in the new storefront. Product and
      // category paths are shared across regions, so this is safe.
      const rest = location.pathname.replace(/^\/[a-z]{2}/, '')
      navigate(`/${next}${rest}${location.search}`)
    },
    [region, location.pathname, location.search, navigate],
  )

  const value = useMemo<RegionContextValue>(
    () => ({ region, config: merge(REGIONS[region], overrides), setRegion, href }),
    [region, overrides, setRegion, href],
  )

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>
}

export function useRegion(): RegionContextValue {
  const ctx = useContext(RegionContext)
  if (!ctx) throw new Error('useRegion must be used inside a RegionProvider')
  return ctx
}
