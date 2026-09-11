import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { REGIONS, type RegionCode, type RegionConfig } from './config'
import { STORAGE_KEYS, writeString } from '../lib/storage'

type RegionContextValue = {
  region: RegionCode
  config: RegionConfig
  /** Switch storefront, staying on the equivalent page. */
  setRegion: (next: RegionCode) => void
  /** Prefixes an in-store path with the active region: "/cart" -> "/ae/cart". */
  href: (path: string) => string
}

const RegionContext = createContext<RegionContextValue | null>(null)

export function RegionProvider({ region, children }: { region: RegionCode; children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()

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
    () => ({ region, config: REGIONS[region], setRegion, href }),
    [region, setRegion, href],
  )

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>
}

export function useRegion(): RegionContextValue {
  const ctx = useContext(RegionContext)
  if (!ctx) throw new Error('useRegion must be used inside a RegionProvider')
  return ctx
}
