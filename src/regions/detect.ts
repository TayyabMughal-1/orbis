import { DEFAULT_REGION, isRegionCode, type RegionCode } from './config'

// ---------------------------------------------------------------------
// Working out which of the three storefronts a first-time visitor
// should land on.
//
// Order of authority:
//   1. an explicit /us, /ae, /pk in the URL          (handled by routing)
//   2. a stored choice from the region switcher      (handled by context)
//   3. a country from the edge/CDN or a geo endpoint (fetchGeoCountry)
//   4. the browser's own timezone + languages        (guessFromBrowser)
//   5. DEFAULT_REGION
//
// Steps 3-5 live here. The browser guess runs first and instantly, so
// the page never blocks on a network call; the geo lookup then refines
// it if it disagrees and the visitor has not chosen for themselves.
// ---------------------------------------------------------------------

/** ISO-3166 alpha-2 -> storefront. Anything unlisted falls through. */
const COUNTRY_TO_REGION: Record<string, RegionCode> = {
  US: 'us',
  PR: 'us',
  GU: 'us',
  VI: 'us',
  AE: 'ae',
  PK: 'pk',
}

/** IANA timezones that pin a visitor to one of our markets. */
const TIMEZONE_TO_REGION: Record<string, RegionCode> = {
  'Asia/Karachi': 'pk',
  'Asia/Dubai': 'ae',
  'Asia/Muscat': 'ae',
}

export function regionForCountry(countryCode: string | null | undefined): RegionCode | null {
  if (!countryCode) return null
  return COUNTRY_TO_REGION[countryCode.toUpperCase()] ?? null
}

function fromTimezone(): RegionCode | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz) return null
    if (TIMEZONE_TO_REGION[tz]) return TIMEZONE_TO_REGION[tz]
    // Every America/* zone that is not Canada or Latin America is a
    // reasonable US guess; the switcher is one click away regardless.
    if (tz.startsWith('America/') || tz.startsWith('US/') || tz.startsWith('Pacific/Honolulu')) {
      return 'us'
    }
    return null
  } catch {
    return null
  }
}

function fromLanguages(): RegionCode | null {
  try {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const tag of tags) {
      if (!tag) continue
      // "en-AE" -> AE, "ur-PK" -> PK, "ar-AE" -> AE
      const parts = tag.split('-')
      const country = parts.length > 1 ? parts[parts.length - 1] : null
      const match = regionForCountry(country)
      if (match) return match
      // Bare language tags that strongly imply a market.
      if (tag.toLowerCase().startsWith('ur')) return 'pk'
    }
    return null
  } catch {
    return null
  }
}

/** Instant, offline, no network. Returns null when it cannot tell. */
export function guessFromBrowser(): RegionCode | null {
  return fromTimezone() ?? fromLanguages()
}

// ---------------------------------------------------------------------
// Geo endpoint
//
// In production this should be YOUR origin, returning the country your
// CDN already resolved — Cloudflare gives you `CF-IPCountry`, Vercel
// `x-vercel-ip-country`, CloudFront `CloudFront-Viewer-Country`. A tiny
// handler echoing that header as {"country":"AE"} is all this needs, and
// it keeps visitor IPs off third-party services.
//
// Set VITE_GEO_ENDPOINT to switch it on. With it unset the app relies on
// the browser guess alone, which is why nothing here is required.
// ---------------------------------------------------------------------

const GEO_ENDPOINT: string | undefined = import.meta.env.VITE_GEO_ENDPOINT
const GEO_TIMEOUT_MS = 1500

export async function fetchGeoCountry(): Promise<string | null> {
  if (!GEO_ENDPOINT) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS)
  try {
    const res = await fetch(GEO_ENDPOINT, { signal: controller.signal })
    if (!res.ok) return null
    const data = (await res.json()) as { country?: string; country_code?: string }
    return data.country ?? data.country_code ?? null
  } catch {
    // Offline, blocked, or slower than the timeout — the browser guess
    // already gave us something usable.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Best guess available right now, without waiting on the network. */
export function detectRegionSync(): RegionCode {
  return guessFromBrowser() ?? DEFAULT_REGION
}

/** Refines the sync guess once the geo endpoint answers, if configured. */
export async function detectRegionAsync(): Promise<RegionCode> {
  const country = await fetchGeoCountry()
  const fromGeo = regionForCountry(country)
  if (fromGeo) return fromGeo
  return detectRegionSync()
}

export function coerceRegion(value: unknown): RegionCode | null {
  return isRegionCode(value) ? value : null
}
