import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { PRODUCTS, CATEGORIES } from './src/api/db'
import { REGION_CODES, REGIONS } from './src/regions/config'

// ---------------------------------------------------------------------
// Sitemap + robots, generated from the catalogue at build time.
//
// A three-region store has three parallel URL trees, and a crawler has
// no way to know the /ae one exists unless we tell it. Each entry lists
// its siblings as xhtml:link alternates, which is the sitemap-side twin
// of the hreflang tags in lib/seo.tsx — the two are meant to agree, and
// both are generated from the same REGIONS list so they cannot drift.
//
// Set VITE_SITE_URL to your real domain before building for production.
// ---------------------------------------------------------------------

const SITE_URL = (process.env.VITE_SITE_URL ?? 'https://orbis.example').replace(/\/$/, '')

/** Region-relative paths that should be indexed, with crawl priority. */
function indexablePaths(): { path: string; priority: number; changefreq: string }[] {
  return [
    { path: '', priority: 1.0, changefreq: 'daily' },
    { path: '/shop', priority: 0.9, changefreq: 'daily' },
    ...CATEGORIES.map((c) => ({
      path: `/shop/${c.id}`,
      priority: 0.8,
      changefreq: 'weekly',
    })),
    ...PRODUCTS.map((p) => ({
      path: `/product/${p.slug}`,
      priority: 0.7,
      changefreq: 'weekly',
    })),
    { path: '/help', priority: 0.5, changefreq: 'monthly' },
    { path: '/orders', priority: 0.3, changefreq: 'monthly' },
  ]
}

function buildSitemap(): string {
  const today = new Date().toISOString().split('T')[0]
  const entries: string[] = []

  for (const region of REGION_CODES) {
    for (const { path, priority, changefreq } of indexablePaths()) {
      const alternates = REGION_CODES.map(
        (alt) =>
          `    <xhtml:link rel="alternate" hreflang="${REGIONS[alt].locale}" href="${SITE_URL}/${alt}${path}"/>`,
      )
      alternates.push(
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/us${path}"/>`,
      )

      entries.push(
        [
          '  <url>',
          `    <loc>${SITE_URL}/${region}${path}</loc>`,
          ...alternates,
          `    <lastmod>${today}</lastmod>`,
          `    <changefreq>${changefreq}</changefreq>`,
          `    <priority>${priority.toFixed(1)}</priority>`,
          '  </url>',
        ].join('\n'),
      )
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')
}

function buildRobots(): string {
  return [
    'User-agent: *',
    'Allow: /',
    '',
    '# Nothing here is useful in an index, and all of it is per-visitor.',
    'Disallow: /*/cart',
    'Disallow: /*/checkout',
    'Disallow: /*/order/',
    'Disallow: /*?q=',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n')
}

function seoFiles(): Plugin {
  return {
    name: 'orbis-seo-files',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: buildSitemap() })
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: buildRobots() })
    },
  }
}

// ---------------------------------------------------------------------
// Where the built storefront looks for the API.
//
// On Vercel the API is a serverless function on the same origin, so the
// bundle has to be built pointing at /api. Deciding that here rather
// than in the build command means it cannot be lost by someone changing
// the build command in the Vercel dashboard — the most common way to
// end up with a shop that loads with an empty catalogue.
//
// ORBIS_SAME_ORIGIN_API does the same thing locally. It carries "1"
// rather than "/api" on purpose: Git Bash on Windows rewrites anything
// that looks like an absolute POSIX path in an argument, so
// `VITE_API_URL=/api npm run build` silently becomes
// `VITE_API_URL=C:/Program Files/Git/api`. A value of "1" survives.
// ---------------------------------------------------------------------

if (!process.env.VITE_API_URL && (process.env.VERCEL || process.env.ORBIS_SAME_ORIGIN_API)) {
  process.env.VITE_API_URL = '/api'
}

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:8787'

// Proxying /api keeps the storefront same-origin in development, so
// there are no CORS preflights and VITE_API_URL can simply be "/api".
const proxy = {
  '/api': { target: API_TARGET, changeOrigin: true },
}

export default defineConfig({
  plugins: [react(), seoFiles()],
  server: { proxy },
  preview: { proxy },
  build: {
    rollupOptions: {
      output: {
        // Router and icons change far less often than store code, so
        // giving them their own chunk keeps them cached across deploys.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
