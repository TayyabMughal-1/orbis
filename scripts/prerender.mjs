// Bakes per-route <head> tags into static HTML after `vite build`.
//
// The storefront is a client-rendered SPA, so every route served the same
// shell and the real title, description, canonical, hreflang and
// structured data were written by JavaScript after load. Google renders
// JS and gets there eventually; Bing and every social scraper do not, and
// even for Google it costs crawl budget and delays indexing.
//
// This writes dist/<route>/index.html for each indexable route with those
// tags already in place. Vercel checks the filesystem before it applies
// rewrites, so these are served directly and the SPA hydrates over them.
// A route that is not prerendered — a product added through the dashboard
// since the last deploy — still falls through the rewrite to the plain
// shell and works exactly as before, just without the baked head.
//
// The tags it writes deliberately carry the same data-seo keys that
// lib/seo.tsx looks for. That module upserts by selector, so matching the
// keys means hydration UPDATES these tags rather than appending a second
// canonical and a second set of hreflangs next to them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const DIST = 'dist'
const SITE_URL = (process.env.VITE_SITE_URL ?? 'https://orbis.example').replace(/\/$/, '')

// --- load the app's own data, so the prerender cannot drift from it ----
const TMP = 'node_modules/.tmp-prerender.cjs'
mkdirSync(dirname(TMP), { recursive: true })
writeFileSync(
  'node_modules/.tmp-prerender-entry.ts',
  `export { REGIONS, REGION_CODES } from '${process.cwd().replace(/\\/g, '/')}/src/regions/config'
   export { PRODUCTS, CATEGORIES } from '${process.cwd().replace(/\\/g, '/')}/src/api/db'`,
)
execFileSync(
  'node',
  [
    'node_modules/esbuild/bin/esbuild',
    'node_modules/.tmp-prerender-entry.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${TMP}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
)
const { REGIONS, REGION_CODES, PRODUCTS, CATEGORIES } = require(`${process.cwd()}/${TMP}`)

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const abs = (region, path) => `${SITE_URL}/${region}${path === '/' || !path ? '' : path}`

/** Every tag lib/seo.tsx would have written, as static HTML. */
function head({ region, path, title, description, type = 'website', jsonLd, noindex }) {
  const config = REGIONS[region]
  const full = `${title} | Orbis Store ${config.countryCode}`
  const canonical = abs(region, path)
  const ogImage = `${SITE_URL}/og-${region}.png`

  const tags = [
    `<title>${esc(full)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}">`,
    // data-seo keys matter: they are what stops hydration duplicating these
    `<link rel="canonical" data-seo="canonical" href="${esc(canonical)}">`,
    ...REGION_CODES.map(
      (code) =>
        `<link rel="alternate" data-seo="alt-${code}" hreflang="${REGIONS[code].locale}" href="${esc(abs(code, path))}">`,
    ),
    `<link rel="alternate" data-seo="alt-default" hreflang="x-default" href="${esc(abs('us', path))}">`,
    `<meta property="og:title" content="${esc(full)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(ogImage)}">`,
    `<meta property="og:site_name" content="Orbis Store ${config.countryCode}">`,
    `<meta property="og:locale" content="${config.locale.replace('-', '_')}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(full)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(ogImage)}">`,
  ]
  if (jsonLd) {
    tags.push(
      `<script id="seo-jsonld" type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
    )
  }
  return tags.map((t) => `    ${t}`).join('\n')
}

// --- the shell -------------------------------------------------------
const shell = readFileSync(join(DIST, 'index.html'), 'utf8')

/**
 * Strips the shell's own generic head tags before injecting the specific
 * ones. Without this the file carries two titles and two og:title, and a
 * crawler picks whichever it likes.
 */
function stripGeneric(html) {
  return html
    .replace(/\n?\s*<title>[\s\S]*?<\/title>/i, '')
    .replace(/\n?\s*<meta\s+name="description"[^>]*>/gi, '')
    .replace(/\n?\s*<meta\s+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/\n?\s*<meta\s+name="twitter:[^"]*"[^>]*>/gi, '')
}

function write(route, headHtml) {
  const html = stripGeneric(shell).replace('</head>', `${headHtml}\n  </head>`)
  const out = join(DIST, route, 'index.html')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, html)
}

// --- routes ----------------------------------------------------------
const money = (product, region) => Math.min(...product.variants.map((v) => v.price[region]))
const inStock = (product, region) => product.variants.some((v) => v.stock[region] > 0)

let count = 0

for (const region of REGION_CODES) {
  const config = REGIONS[region]

  write(
    region,
    head({
    region,
    path: '/',
    title: `Orbis figures, homeware and apparel delivered in ${config.country}`,
    description: `Hand-painted Orbis figures, homeware, lighting, apparel and prints. Priced in ${config.currency.code}, shipped across ${config.country}.`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name: `Orbis Store ${config.countryCode}`,
          url: abs(region, '/'),
          email: config.support.email,
          telephone: config.support.phone,
        },
        {
          '@type': 'WebSite',
          name: `Orbis Store ${config.countryCode}`,
          url: abs(region, '/'),
          inLanguage: config.locale,
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: `${abs(region, '/shop')}?q={q}` },
            'query-input': 'required name=q',
          },
        },
      ],
      },
    }),
  )
  count += 1

  write(
    `${region}/shop`,
    head({
      region,
      path: '/shop',
      title: `Everything in the ${config.country} store`,
      description: `Every Orbis figure, homeware piece, light, garment and print available in ${config.country}, priced in ${config.currency.code}.`,
    }),
  )
  count += 1

  for (const category of CATEGORIES) {
    write(
      `${region}/shop/${category.id}`,
      head({
        region,
        path: `/shop/${category.id}`,
        title: category.label,
        description: `${category.blurb} Shipped across ${config.country}, priced in ${config.currency.code}.`,
      }),
    )
    count += 1
  }

  for (const product of PRODUCTS) {
    const price = money(product, region)
    write(
      `${region}/product/${product.slug}`,
      head({
        region,
        path: `/product/${product.slug}`,
        title: product.name,
        type: 'product',
        description: `${product.tagline} ${product.description}`.trim().slice(0, 300),
        jsonLd: {
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
            // schema.org wants a major-unit decimal; the catalogue stores
            // minor units, and PKR has none.
            lowPrice: (price / 10 ** config.currency.decimals).toFixed(config.currency.decimals),
            priceCurrency: config.currency.code,
            offerCount: product.variants.length,
            availability: inStock(product, region)
              ? 'https://schema.org/InStock'
              : 'https://schema.org/OutOfStock',
            url: abs(region, `/product/${product.slug}`),
          },
        },
      }),
    )
    count += 1
  }

  write(
    `${region}/help`,
    head({
      region,
      path: '/help',
      title: 'Delivery, returns and contact',
      description: `Delivery times, ${config.policy.returnsDays}-day returns and how to reach us in ${config.country}.`,
    }),
  )
  count += 1
}

console.log(`[prerender] wrote ${count} routes with baked head tags (site ${SITE_URL})`)
