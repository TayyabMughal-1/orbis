import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { ApiError, badRequest, tooMany } from './errors.js'
import { connect, ping, stats as dbStats } from './db.js'
import {
  createOrder,
  getOrder,
  getOrderByIdempotencyKey,
  getProductBySlug,
  getRelated,
  getPromo,
  listOrdersByEmail,
  listProducts,
  searchProducts,
} from './repo.js'
import { assertInStock, priceOrder } from './service.js'
import { authorizePayment } from './payments.js'
import { asAddress, asCartLines, asEmail, asOptionalString, asRegion, asString } from './validate.js'
import { admin } from './admin.js'
import { account } from './customers.js'
import { adminEnabled } from './auth.js'
import { listCategories, listCollections, publicSettings, resolveRegionConfig } from './adminRepo.js'
import { REGIONS } from '../../src/regions/config.js'
import type { Category } from '../../src/types.js'

// ---------------------------------------------------------------------
// The Orbis API.
//
// Every route the storefront needs and nothing it does not. The client
// (src/api/client.ts) speaks exactly these shapes, so pointing the app
// at this server is a one-line environment change.
// ---------------------------------------------------------------------

const app = express()

app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))

// Set TRUST_PROXY when this runs behind nginx, a load balancer or a CDN
// (1 = one hop). Without it every customer looks like the proxy and the
// rate limiter throttles them collectively. With it set when there is no
// proxy, a client could forge X-Forwarded-For and dodge the limiter —
// which is why it is off unless you say otherwise.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY)
  app.set('trust proxy', Number.isFinite(hops) ? hops : process.env.TRUST_PROXY)
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

// Hosts allowed to call the API from a browser. In production this is
// the only list that counts — set CORS_ORIGINS to your storefront's
// real origin(s), comma separated.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function originAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true
  // Outside production, any local port is fine — Vite's dev server and
  // its preview server pick different ones, and both proxy /api here.
  return !IS_PRODUCTION && LOCALHOST.test(origin)
}

const refusedOrigins = new Set<string>()

app.use(
  cors({
    origin(origin, callback) {
      // Browsers omit Origin on same-origin GETs but DO send it on
      // same-origin POSTs, so a request arriving through the dev proxy
      // still lands here with the storefront's own origin.
      if (!origin || originAllowed(origin)) return callback(null, true)

      // Reply without CORS headers rather than throwing. Throwing turns
      // an ordinary policy decision into a 500 and buries the real
      // reason in a stack trace.
      if (!refusedOrigins.has(origin)) {
        refusedOrigins.add(origin)
        console.warn(`[api] refusing browser requests from ${origin} (set CORS_ORIGINS to allow it)`)
      }
      callback(null, false)
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key'],
    maxAge: 86400,
  }),
)

/** Wraps a handler so a thrown ApiError reaches the error middleware. */
const route =
  (handler: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(handler(req, res)).catch(next)
    } catch (err) {
      next(err)
    }
  }

// ------------------------------------------------------- rate limiting
//
// Per-IP counters held in memory. Fine for one instance; move to Redis
// the moment there are two, or each will only see a third of the traffic
// and the limits will be three times looser than intended.

const RATE_LIMIT_ON = process.env.RATE_LIMIT !== 'off'

/** Orders per IP per hour. Generous — a family or an office shares one. */
const ORDER_LIMIT = Number(process.env.ORDER_RATE_LIMIT ?? 30)

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

function limit(key: string, max: number, windowMs: number): void {
  if (!RATE_LIMIT_ON) return

  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  bucket.count += 1
  if (bucket.count > max) {
    throw tooMany('Too many attempts. Please wait a moment and try again.')
  }
}

// Keeps the map from growing without bound on a long-lived process.
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(key)
}, 60_000).unref()

const clientKey = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown'

// -------------------------------------------------------------- routes

app.get(
  '/api/health',
  route(async (_req, res) => {
    res.json({ ok: await ping(), database: 'postgres', ...(await dbStats()) })
  }),
)

/**
 * Country lookup for first-time visitors.
 *
 * It reads whatever geo header the CDN in front of this server already
 * set. That keeps visitor IPs out of third-party lookup services, and
 * costs nothing — the edge resolved it before the request arrived.
 */
app.get(
  '/api/geo',
  route((req, res) => {
    const header =
      req.get('cf-ipcountry') ??
      req.get('x-vercel-ip-country') ??
      req.get('cloudfront-viewer-country') ??
      req.get('x-country-code') ??
      null

    const country = header && header !== 'XX' ? header.toUpperCase() : null
    res.set('Cache-Control', 'no-store')
    res.json({ country })
  }),
)

/**
 * The editable slice of a region's configuration.
 *
 * The storefront merges this over its built-in defaults, so copy and
 * delivery prices changed in the dashboard show up without a rebuild.
 * Everything here is public by design — it is what the shop already
 * displays.
 */
app.get(
  '/api/settings',
  route(async (req, res) => {
    const region = asRegion(req.query.region)
    // Revalidate every time rather than caching for a window. An
    // operator who changes the banner and then reloads the shop must see
    // it — waiting out a cache looks like the save silently failed. The
    // payload is tiny and unchanged responses come back as a 304.
    res.set('Cache-Control', 'no-cache')
    res.json(await publicSettings(region))
  }),
)

// The storefront's own copies of the taxonomy. Only the active rows, and
// without the product counts the dashboard needs — a shopper has no use
// for a department that has been switched off.
app.get(
  '/api/categories',
  route(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const region = asRegion(req.query.region)
    const rows = await listCategories()
    res.json(
      rows
        .filter((c) => c.active && c.regions.includes(region))
        .map(({ productCount: _count, ...rest }) => rest),
    )
  }),
)

app.get(
  '/api/collections',
  route(async (_req, res) => {
    res.set('Cache-Control', 'no-store')
    const rows = await listCollections()
    res.json(rows.filter((c) => c.active).map(({ productCount: _count, ...rest }) => rest))
  }),
)

app.get(
  '/api/products',
  route(async (req, res) => {
    const region = asRegion(req.query.region)
    const category = (req.query.category as string | undefined) ?? 'all'
    const sort = (req.query.sort as string | undefined) ?? 'featured'
    const limitParam = req.query.limit ? Number(req.query.limit) : undefined

    if (limitParam !== undefined && (!Number.isInteger(limitParam) || limitParam < 1 || limitParam > 100)) {
      throw badRequest('invalid_limit', '"limit" must be a whole number between 1 and 100.')
    }

    const products = await listProducts({
      region,
      category: category as Category | 'all',
      search: (req.query.search as string | undefined) ?? undefined,
      sort: sort as 'featured' | 'price-asc' | 'price-desc' | 'name',
      inStockOnly: req.query.inStockOnly === 'true' || req.query.inStockOnly === '1',
      // ?from=local or ?from=import. Anything else is no filter at all
      // rather than an error — a stray value should show the catalogue,
      // not a 400.
      origin:
        req.query.from === 'import' ? 'import' : req.query.from === 'local' ? 'local' : undefined,
      limit: limitParam,
    })

    // Catalogue data is safe to cache briefly at the edge; stock is the
    // only volatile part and checkout re-checks it anyway.
    res.set('Cache-Control', 'public, max-age=30')
    res.json(products)
  }),
)

// Search, with suggestions when nothing matches. Separate from
// /api/products because the response is a shape, not a list: the page has
// to know whether it is showing results or consolation.
app.get(
  '/api/search',
  route(async (req, res) => {
    const region = asRegion(req.query.region)
    limit(`search:${clientKey(req)}`, 120, 60_000)
    res.set('Cache-Control', 'no-store')
    res.json(await searchProducts(region, asOptionalString(req.query.q, 'q', 120) || ''))
  }),
)

app.get(
  '/api/products/:slug',
  route(async (req, res) => {
    const product = await getProductBySlug(asString(req.params.slug, 'slug', 120))
    res.set('Cache-Control', 'public, max-age=30')
    res.json(product)
  }),
)

app.get(
  '/api/products/:slug/related',
  route(async (req, res) => {
    const region = asRegion(req.query.region)
    res.set('Cache-Control', 'public, max-age=60')
    res.json(await getRelated(asString(req.params.slug, 'slug', 120), region))
  }),
)

app.post(
  '/api/promos/validate',
  route(async (req, res) => {
    limit(`promo:${clientKey(req)}`, 30, 60_000)

    const region = asRegion(req.body?.region)
    const code = asString(req.body?.code, 'code', 40).toUpperCase()
    const subtotal = Number(req.body?.subtotal ?? 0)

    if (!Number.isInteger(subtotal) || subtotal < 0) {
      throw badRequest('invalid_subtotal', '"subtotal" must be a whole number of minor units.')
    }

    const promo = await getPromo(code)
    if (!promo) throw badRequest('promo_invalid', `"${code}" is not a code we recognise.`)
    if (!promo.regions.includes(region)) {
      throw badRequest(
        'promo_region',
        `"${code}" is not valid in the ${REGIONS[region].country} store.`,
      )
    }
    if (subtotal < promo.minSubtotal[region]) {
      throw badRequest('promo_minimum', `"${code}" needs a larger order to apply.`)
    }

    res.json({ code: promo.code, label: promo.label, percentOff: promo.percentOff })
  }),
)

app.post(
  '/api/quote',
  route(async (req, res) => {
    const region = asRegion(req.body?.region)
    const lines = asCartLines(req.body?.lines)

    const quote = await priceOrder({
      region,
      lines,
      shippingId: asOptionalString(req.body?.shippingId, 'shippingId', 60) || undefined,
      paymentMethodId: asOptionalString(req.body?.paymentMethodId, 'paymentMethodId', 60) || undefined,
      promoCode: asOptionalString(req.body?.promoCode, 'promoCode', 40) || null,
      subRegion: asOptionalString(req.body?.subRegion, 'subRegion', 100) || undefined,
    })

    const { priced: _priced, ...body } = quote
    res.set('Cache-Control', 'no-store')
    res.json(body)
  }),
)

app.post(
  '/api/orders',
  route(async (req, res) => {
    limit(`order:${clientKey(req)}`, ORDER_LIMIT, 60 * 60_000)

    // A retry after a dropped response must return the original order
    // rather than doing any of this again. That has to happen first:
    // further down, assertInStock would reject the retry as sold out —
    // the customer's own purchase having taken the last one — and
    // authorizePayment would run a second time before the idempotency
    // check inside createOrder was ever reached.
    const replayKey = req.get('idempotency-key') ?? null
    if (replayKey) {
      const already = await getOrderByIdempotencyKey(replayKey)
      if (already) {
        res.set('Cache-Control', 'no-store')
        res.json(already)
        return
      }
    }

    const region = asRegion(req.body?.region)
    const lines = asCartLines(req.body?.lines)
    const address = asAddress(req.body?.address, region)
    const paymentMethodId = asString(req.body?.paymentMethodId, 'paymentMethodId', 60)

    const config = await resolveRegionConfig(region)
    const method = config.paymentMethods.find((m) => m.id === paymentMethodId)
    if (!method) {
      throw badRequest(
        'payment_invalid',
        `${paymentMethodId} is not accepted in the ${config.country} store.`,
      )
    }

    // Price it again from scratch. Whatever the browser believed the
    // total was is irrelevant.
    const quote = await priceOrder({
      region,
      lines,
      shippingId: asOptionalString(req.body?.shippingId, 'shippingId', 60) || undefined,
      paymentMethodId,
      promoCode: asOptionalString(req.body?.promoCode, 'promoCode', 40) || null,
      subRegion: address.region,
    })

    await assertInStock(quote.priced, region)

    const payment = await authorizePayment({
      region,
      methodId: paymentMethodId,
      amount: quote.totals.total,
      currency: quote.totals.currency,
      orderEmail: address.email,
    })

    const order = await createOrder({
      region,
      email: address.email,
      address,
      shipping: quote.selectedShipping,
      paymentMethodId: method.id,
      paymentMethodLabel: method.label,
      paymentStatus: payment.status,
      paymentReference: payment.reference,
      promoCode: quote.promo?.code ?? null,
      lines: quote.priced.map(({ stock: _stock, ...line }) => line),
      totals: quote.totals,
      // createOrder checks this again, which closes the window between
      // the lookup above and this insert for two genuinely simultaneous
      // retries.
      idempotencyKey: replayKey,
    })

    res.status(201).json({ ...order, paymentInstructions: payment.instructions })
  }),
)

app.get(
  '/api/orders/:number',
  route(async (req, res) => {
    limit(`lookup:${clientKey(req)}`, 40, 60_000)
    res.set('Cache-Control', 'no-store')
    res.json(await getOrder(asString(req.params.number, 'number', 40)))
  }),
)

app.get(
  '/api/orders',
  route(async (req, res) => {
    // Listing requires an email. Without it this would hand any caller
    // the entire order book.
    const region = asRegion(req.query.region)
    const email = asEmail(req.query.email)
    limit(`orders:${clientKey(req)}`, 30, 60_000)
    res.set('Cache-Control', 'no-store')
    res.json(await listOrdersByEmail(region, email))
  }),
)

// ------------------------------------------------------------- admin

app.use('/api/admin', admin)
app.use('/api/account', account)

// ----------------------------------------------------------- fallbacks

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } })
})

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } })
    return
  }
  // Never leak an internal message to a customer.
  console.error('[api] unhandled error:', err)
  res.status(500).json({
    error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' },
  })
})

// ---------------------------------------------------------------------
// Readiness
//
// The database connection is established once and reused. On a normal
// server that happens at boot; on serverless it happens on the first
// request into a cold container and is then cached, which is why this is
// awaited per request rather than at module load.
// ---------------------------------------------------------------------

let ready: Promise<void> | null = null

export function ensureReady(): Promise<void> {
  if (!ready) {
    ready = connect().catch((err) => {
      // Do not cache a failed connection, or every later request rides
      // the same broken promise.
      ready = null
      throw err
    })
  }
  return ready
}

export { app, adminEnabled }
export default app
