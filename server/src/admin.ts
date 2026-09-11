import { Router, type Request, type Response, type NextFunction } from 'express'
import { ApiError, badRequest } from './errors'
import { adminEnabled, checkPassword, issueToken, requireAdmin } from './auth'
import {
  deleteProduct,
  deletePromo,
  getSettings,
  listAllOrders,
  listPromos,
  putSettings,
  saveProduct,
  savePromo,
  updateOrder,
  type ProductInput,
  type PromoInput,
  type RegionSettings,
} from './adminRepo'
import { getProductBySlug, listProducts, stats } from './repo'
import { REGION_CODES, isRegionCode, type RegionCode } from '../../src/regions/config'
import { asRegion, asString } from './validate'

// ---------------------------------------------------------------------
// The admin API.
//
// Everything below /api/admin needs a bearer token, with one exception:
// the login route that issues it. The storefront never calls any of it.
// ---------------------------------------------------------------------

export const admin = Router()

const route =
  (handler: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(handler(req, res)).catch(next)
    } catch (err) {
      next(err)
    }
  }

// ---------------------------------------------------------------- auth

/**
 * Login attempts are throttled hard and per-IP. A single shared password
 * is only safe if guessing it is slow.
 */
const attempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 8
const WINDOW_MS = 15 * 60_000

function throttleLogin(key: string): void {
  const now = Date.now()
  const record = attempts.get(key)
  if (!record || record.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  record.count += 1
  if (record.count > MAX_ATTEMPTS) {
    throw new ApiError(429, 'rate_limited', 'Too many sign-in attempts. Try again in 15 minutes.')
  }
}

admin.post(
  '/login',
  route((req, res) => {
    if (!adminEnabled()) {
      throw new ApiError(
        503,
        'admin_disabled',
        'Admin access is switched off because no ADMIN_PASSWORD is set on the server.',
      )
    }

    const key = req.ip ?? 'unknown'
    throttleLogin(key)

    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!checkPassword(password)) {
      throw new ApiError(401, 'bad_credentials', 'That password is not right.')
    }

    attempts.delete(key)
    const { token, expiresAt } = issueToken()
    res.json({ token, expiresAt })
  }),
)

// Everything from here on requires the token.
admin.use(requireAdmin)

admin.get(
  '/session',
  route((_req, res) => res.json({ ok: true, ...stats() })),
)

// ------------------------------------------------------------ products

function asProductInput(body: unknown): ProductInput {
  if (typeof body !== 'object' || body === null) throw badRequest('invalid_body', 'Expected a product.')
  const raw = body as Record<string, any>

  const variants = Array.isArray(raw.variants) ? raw.variants : []
  if (variants.length === 0) {
    throw badRequest('no_variants', 'Add at least one variant — that is what carries price and stock.')
  }

  const price = (v: any) => {
    const out = {} as Record<RegionCode, number>
    for (const region of REGION_CODES) {
      const value = Number(v?.[region] ?? 0)
      if (!Number.isFinite(value) || value < 0) {
        throw badRequest('invalid_price', 'Prices must be zero or more, in minor units.')
      }
      out[region] = Math.round(value)
    }
    return out
  }

  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    slug: asString(raw.slug ?? raw.name, 'slug', 120),
    name: asString(raw.name, 'name', 120),
    tagline: typeof raw.tagline === 'string' ? raw.tagline.slice(0, 200) : '',
    description: typeof raw.description === 'string' ? raw.description.slice(0, 4000) : '',
    highlights: Array.isArray(raw.highlights)
      ? raw.highlights.filter((h: unknown) => typeof h === 'string').slice(0, 10)
      : [],
    rating:
      raw.rating && Number.isFinite(Number(raw.rating.average))
        ? {
            average: Math.min(5, Math.max(0, Number(raw.rating.average))),
            count: Math.max(0, Math.round(Number(raw.rating.count) || 0)),
          }
        : null,
    category: asString(raw.category, 'category', 40),
    badges: Array.isArray(raw.badges)
      ? raw.badges.filter((b: unknown) => typeof b === 'string').slice(0, 6)
      : [],
    media: Array.isArray(raw.media) ? raw.media.slice(0, 8) : [],
    specs: Array.isArray(raw.specs)
      ? raw.specs
          .filter((sp: any) => sp && typeof sp.label === 'string' && typeof sp.value === 'string')
          .slice(0, 20)
      : [],
    featured: Math.max(0, Math.min(100, Math.round(Number(raw.featured) || 0))),
    weightGrams: Math.max(0, Math.round(Number(raw.weightGrams) || 0)),
    variants: variants.map((v: any, i: number) => ({
      id: typeof v.id === 'string' ? v.id : undefined,
      sku: asString(v.sku, `variants[${i}].sku`, 60),
      label: asString(v.label, `variants[${i}].label`, 80),
      options: {
        size: typeof v.options?.size === 'string' ? v.options.size : undefined,
        color: typeof v.options?.color === 'string' ? v.options.color : undefined,
        colorHex: typeof v.options?.colorHex === 'string' ? v.options.colorHex : undefined,
      },
      price: price(v.price),
      compareAt: null,
      stock: price(v.stock),
    })),
  }
}

admin.get(
  '/products',
  route((_req, res) => {
    // Admin sees every product, in every region, regardless of stock.
    res.json(listProducts({ region: 'us' }))
  }),
)

admin.get(
  '/products/:slug',
  route((req, res) => res.json(getProductBySlug(asString(req.params.slug, 'slug', 120)))),
)

admin.post(
  '/products',
  route((req, res) => res.status(201).json(saveProduct(asProductInput(req.body)))),
)

admin.put(
  '/products/:id',
  route((req, res) => {
    const input = asProductInput(req.body)
    input.id = asString(req.params.id, 'id', 80)
    res.json(saveProduct(input))
  }),
)

admin.delete(
  '/products/:id',
  route((req, res) => {
    deleteProduct(asString(req.params.id, 'id', 80))
    res.json({ ok: true })
  }),
)

// -------------------------------------------------------------- promos

function asPromoInput(body: unknown): PromoInput {
  if (typeof body !== 'object' || body === null) throw badRequest('invalid_body', 'Expected a promo code.')
  const raw = body as Record<string, any>

  const regions = Array.isArray(raw.regions) ? raw.regions.filter(isRegionCode) : []
  const minSubtotal = {} as Record<RegionCode, number>
  for (const region of REGION_CODES) {
    minSubtotal[region] = Math.max(0, Math.round(Number(raw.minSubtotal?.[region]) || 0))
  }

  return {
    code: asString(raw.code, 'code', 40),
    label: asString(raw.label, 'label', 120),
    percentOff: Math.round(Number(raw.percentOff) || 0),
    regions,
    minSubtotal,
    active: raw.active !== false,
  }
}

admin.get(
  '/promos',
  route((_req, res) => res.json(listPromos())),
)

admin.post(
  '/promos',
  route((req, res) => res.json(savePromo(asPromoInput(req.body)))),
)

admin.delete(
  '/promos/:code',
  route((req, res) => {
    deletePromo(asString(req.params.code, 'code', 40))
    res.json({ ok: true })
  }),
)

// -------------------------------------------------------------- orders

admin.get(
  '/orders',
  route((req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))
    res.json(listAllOrders(limit))
  }),
)

admin.patch(
  '/orders/:number',
  route((req, res) => {
    const number = asString(req.params.number, 'number', 40)
    res.json(
      updateOrder(number, {
        status: typeof req.body?.status === 'string' ? req.body.status : undefined,
        paymentStatus:
          typeof req.body?.paymentStatus === 'string' ? req.body.paymentStatus : undefined,
      }),
    )
  }),
)

// ------------------------------------------------------------ settings

function asSettings(body: unknown): RegionSettings {
  if (typeof body !== 'object' || body === null) throw badRequest('invalid_body', 'Expected settings.')
  const raw = body as Record<string, any>

  const text = (value: unknown, max = 300) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined

  return {
    promoStrip: text(raw.promoStrip),
    heroEyebrow: text(raw.heroEyebrow),
    heroTitle: text(raw.heroTitle, 120),
    heroBody: text(raw.heroBody, 600),
    supportEmail: text(raw.supportEmail, 254),
    supportPhone: text(raw.supportPhone, 40),
    taxRate: raw.taxRate === undefined || raw.taxRate === null ? undefined : Number(raw.taxRate),
    shipping: Array.isArray(raw.shipping)
      ? raw.shipping.map((t: any) => ({
          id: asString(t.id, 'shipping.id', 60),
          label: asString(t.label, 'shipping.label', 80),
          eta: asString(t.eta, 'shipping.eta', 80),
          amount: Math.max(0, Math.round(Number(t.amount) || 0)),
          freeOver:
            t.freeOver === null || t.freeOver === undefined || t.freeOver === ''
              ? null
              : Math.max(0, Math.round(Number(t.freeOver))),
        }))
      : undefined,
  }
}

admin.get(
  '/settings/:region',
  route((req, res) => res.json(getSettings(asRegion(req.params.region, 'region')))),
)

admin.put(
  '/settings/:region',
  route((req, res) =>
    res.json(putSettings(asRegion(req.params.region, 'region'), asSettings(req.body))),
  ),
)
