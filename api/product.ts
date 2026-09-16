import type { IncomingMessage, ServerResponse } from 'node:http'
import { ensureReady } from '../server/src/app.js'
import { getProductBySlug } from '../server/src/repo.js'
import { REGIONS, isRegionCode, REGION_CODES } from '../src/regions/config.js'

// ---------------------------------------------------------------------
// Product pages, with their head rendered per request.
//
// Every other route is prerendered at build time, which is right for them
// because nothing in their head can go stale. A product's cannot be: it
// carries price and availability, and those change in the dashboard
// between deploys.
//
// Stale markup is not a neutral outcome. Google checks Product schema
// against the rendered page and treats a price that disagrees as a
// violation, so baked-in offers are worse than none the moment someone
// edits a price. This reads the catalogue on the request instead.
//
// The cost is one function invocation per product page — paid once per
// path per five minutes, because the response is cached at the edge and
// served stale for a day while it revalidates. And if anything here
// fails, the unmodified shell is returned: the SPA still renders the
// page, exactly as it did before any of this existed.
// ---------------------------------------------------------------------

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function siteUrl(req: IncomingMessage): string {
  const configured = process.env.VITE_SITE_URL?.replace(/\/$/, '')
  if (configured) return configured
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  return `https://${host}`
}

/** The built shell, fetched from this same deployment. */
async function shell(req: IncomingMessage): Promise<string> {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  // index.html has an extension, so it is served straight off the
  // filesystem rather than looping back through a rewrite into here.
  const res = await fetch(`https://${host}/index.html`)
  return res.text()
}

/**
 * Drops the shell's generic head tags. Without this the page carries two
 * titles and two og:title and a crawler picks whichever it likes.
 */
const stripGeneric = (html: string) =>
  html
    .replace(/\n?\s*<title>[\s\S]*?<\/title>/i, '')
    .replace(/\n?\s*<meta\s+name="description"[^>]*>/gi, '')
    .replace(/\n?\s*<meta\s+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/\n?\s*<meta\s+name="twitter:[^"]*"[^>]*>/gi, '')

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://orbis.invalid')
  const region = url.searchParams.get('region') ?? ''
  const slug = url.searchParams.get('slug') ?? ''

  let html: string
  try {
    html = await shell(req)
  } catch {
    res.statusCode = 500
    res.end('Could not load the page shell.')
    return
  }

  const send = (body: string, cache: string) => {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', cache)
    res.end(body)
  }

  // Anything unexpected and the shell goes out untouched — the SPA
  // renders the page client-side and nothing is broken, only unindexed.
  if (!isRegionCode(region) || !slug) {
    send(html, 'public, s-maxage=60')
    return
  }

  try {
    await ensureReady()
    const product = await getProductBySlug(slug)
    const config = REGIONS[region]

    const price = Math.min(...product.variants.map((v) => v.price[region]))
    const inStock = product.variants.some((v) => v.stock[region] > 0)

    const path = `/product/${product.slug}`
    const site = siteUrl(req)
    const abs = (code: string) => `${site}/${code}${path}`
    const canonical = abs(region)
    const title = `${product.name} | Orbis Store ${config.countryCode}`
    const description = `${product.tagline} ${product.description}`.trim().slice(0, 300)
    const ogImage = `${site}/og-${region}.png`

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: product.description,
      sku: product.variants[0]?.sku,
      category: product.category,
      ...(product.rating
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: product.rating.average,
              reviewCount: product.rating.count,
            },
          }
        : {}),
      offers: {
        '@type': 'AggregateOffer',
        // Prices are stored in minor units and PKR has none, so the
        // divisor is per-region rather than a flat hundred.
        lowPrice: (price / 10 ** config.currency.decimals).toFixed(config.currency.decimals),
        priceCurrency: config.currency.code,
        offerCount: product.variants.length,
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: canonical,
      },
    }

    // data-seo keys are not decoration: lib/seo.tsx upserts by them on
    // hydration, so matching them means it updates these tags instead of
    // appending a second canonical beside them.
    const head = [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(description)}">`,
      `<meta name="robots" content="index, follow, max-image-preview:large">`,
      `<link rel="canonical" data-seo="canonical" href="${esc(canonical)}">`,
      ...REGION_CODES.map(
        (code) =>
          `<link rel="alternate" data-seo="alt-${code}" hreflang="${REGIONS[code].locale}" href="${esc(abs(code))}">`,
      ),
      `<link rel="alternate" data-seo="alt-default" hreflang="x-default" href="${esc(abs('us'))}">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:type" content="product">`,
      `<meta property="og:url" content="${esc(canonical)}">`,
      `<meta property="og:image" content="${esc(ogImage)}">`,
      `<meta property="og:site_name" content="Orbis Store ${config.countryCode}">`,
      `<meta property="og:locale" content="${config.locale.replace('-', '_')}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${esc(title)}">`,
      `<meta name="twitter:description" content="${esc(description)}">`,
      `<meta name="twitter:image" content="${esc(ogImage)}">`,
      `<script id="seo-jsonld" type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
    ]
      .map((t) => `    ${t}`)
      .join('\n')

    send(
      stripGeneric(html).replace('</head>', `${head}\n  </head>`),
      // Cached at the edge, so the database is read once per product per
      // five minutes rather than once per visitor, and a stale copy is
      // served for a day while the next one is fetched behind it.
      'public, s-maxage=300, stale-while-revalidate=86400',
    )
  } catch (err) {
    // A slug that does not exist lands here too. The SPA shows its own
    // not-found page, which is the right thing for a person; the shell
    // carries no product markup, which is the right thing for a crawler.
    if (err instanceof Error) console.error('[product-page]', err.message)
    send(html, 'public, s-maxage=60')
  }
}
