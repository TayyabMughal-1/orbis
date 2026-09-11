import { useEffect } from 'react'
import { REGIONS, REGION_CODES, type RegionConfig } from '../regions/config'
import { useRegion } from '../regions/RegionContext'

// ---------------------------------------------------------------------
// Head management for a three-region storefront.
//
// The part that actually matters here is hreflang. Three storefronts
// selling the same catalogue in near-identical English is exactly the
// shape a search engine reads as duplicate content — one market's pages
// then cannibalise the others. Every page therefore emits:
//
//   • a self-referencing canonical for its own region
//   • alternate links to the same page in the other two regions
//   • an x-default pointing at the US store
//
// which tells a search engine these are the same page localised, and to
// show a shopper in Dubai the AED one.
//
// SPA caveat, stated plainly: these tags are written by JavaScript after
// load. Google renders JS and will see them; several other crawlers and
// most social-preview scrapers will not. For a production storefront,
// prerender or server-render these routes — see README. Everything here
// is written so that switching to SSR needs no change at the call sites.
// ---------------------------------------------------------------------

const SITE_URL: string =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') ??
  (typeof window !== 'undefined' ? window.location.origin : 'https://orbis.example')

const MANAGED = 'data-seo'

function upsertMeta(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(MANAGED, '1')
    document.head.appendChild(el)
  }
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
}

function upsertLink(key: string, attrs: Record<string, string>) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[${MANAGED}="${key}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute(MANAGED, key)
    document.head.appendChild(el)
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
}

function setJsonLdText(json: string) {
  const id = 'seo-jsonld'
  let el = document.getElementById(id) as HTMLScriptElement | null
  if (!json) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('script')
    el.id = id
    el.type = 'application/ld+json'
    document.head.appendChild(el)
  }
  el.textContent = json
}

export function absoluteUrl(regionCode: string, path: string): string {
  const clean = path === '/' || path === '' ? '' : path.startsWith('/') ? path : `/${path}`
  return `${SITE_URL}/${regionCode}${clean}`
}

export type SeoProps = {
  title: string
  description: string
  /** Region-relative path, e.g. "/shop/lighting". */
  path: string
  image?: string
  noindex?: boolean
  /** schema.org objects for this page. */
  jsonLd?: unknown
  type?: 'website' | 'product' | 'article'
}

export function Seo({ title, description, path, image, noindex, jsonLd, type = 'website' }: SeoProps) {
  const { config } = useRegion()
  const fullTitle = `${title} | Orbis Store ${config.countryCode}`
  const canonical = absoluteUrl(config.code, path)

  // Callers build their schema inline, so the object identity changes on
  // every render. Comparing the serialised form instead means the head is
  // only rewritten when the content actually differs.
  const jsonLdText = jsonLd ? JSON.stringify(jsonLd) : ''

  useEffect(() => {
    document.title = fullTitle
    document.documentElement.lang = config.locale

    upsertMeta('meta[name="description"]', { name: 'description', content: description })
    upsertMeta('meta[name="robots"]', {
      name: 'robots',
      content: noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large',
    })

    upsertLink('canonical', { rel: 'canonical', href: canonical })

    // hreflang: this page in every storefront, plus a default.
    for (const code of REGION_CODES) {
      const r = REGIONS[code]
      upsertLink(`alt-${code}`, {
        rel: 'alternate',
        hreflang: r.locale,
        href: absoluteUrl(code, path),
      })
    }
    upsertLink('alt-default', {
      rel: 'alternate',
      hreflang: 'x-default',
      href: absoluteUrl('us', path),
    })

    // Open Graph / Twitter. Each storefront has its own card, so a link
    // shared from the UAE store previews in AED rather than dollars.
    const ogImage = image ?? `${SITE_URL}/og-${config.code}.png`
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: fullTitle })
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description })
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type })
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonical })
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: ogImage })
    upsertMeta('meta[property="og:site_name"]', {
      property: 'og:site_name',
      content: `Orbis Store ${config.countryCode}`,
    })
    upsertMeta('meta[property="og:locale"]', {
      property: 'og:locale',
      content: config.locale.replace('-', '_'),
    })
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' })
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: fullTitle })
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description })
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: ogImage })

    setJsonLdText(jsonLdText)
  }, [fullTitle, description, canonical, config, image, noindex, jsonLdText, type, path])

  return null
}

// ------------------------------------------------------- schema builders

export function organizationSchema(config: RegionConfig) {
  return {
    '@type': 'OnlineStore',
    '@id': `${SITE_URL}/${config.code}#store`,
    name: `Orbis Store ${config.countryCode}`,
    url: absoluteUrl(config.code, '/'),
    email: config.support.email,
    telephone: config.support.phone,
    currenciesAccepted: config.currency.code,
    paymentAccepted: config.paymentMethods.map((m) => m.label).join(', '),
    areaServed: { '@type': 'Country', name: config.country },
    address: {
      '@type': 'PostalAddress',
      streetAddress: config.entity.addressLines[0],
      addressCountry: config.countryCode,
    },
    legalName: config.entity.name,
  }
}

export function breadcrumbSchema(config: RegionConfig, trail: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(config.code, item.path),
    })),
  }
}

/** Wraps one or more schema objects in a single @graph document. */
export function graph(...nodes: unknown[]) {
  return { '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) }
}
