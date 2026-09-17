import { Router, type Request, type Response, type NextFunction } from 'express'
import { ApiError, badRequest } from './errors.js'
import { adminEnabled, authenticate, issueToken, recordLogin, requireAdmin } from './auth.js'
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
  listCategories,
  saveCategory,
  deleteCategory,
  listCollections,
  saveCollection,
  deleteCollection,
  type TaxonomyInput,
  type ProductInput,
  type PromoInput,
  type RegionSettings,
} from './adminRepo.js'
import { getProductBySlug, listProducts } from './repo.js'
import { stats } from './db.js'
import { REGION_CODES, isRegionCode, type RegionCode } from '../../src/regions/config.js'
import { asOptionalString, asRegion, asString } from './validate.js'
import { signUpload, uploadsConfigured } from './uploads.js'

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
  route(async (req, res) => {
    if (!adminEnabled()) {
      throw new ApiError(
        503,
        'admin_disabled',
        'Admin access is switched off because no ADMIN_EMAIL and ADMIN_PASSWORD are set on the server.',
      )
    }

    const key = req.ip ?? 'unknown'
    throttleLogin(key)

    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''

    const user = await authenticate(email, password)
    if (!user) {
      // One message for a wrong email and a wrong password alike, so the
      // response cannot be used to work out which addresses have accounts.
      throw new ApiError(401, 'bad_credentials', 'That email and password do not match.')
    }
    if (user.role !== 'ADMIN') {
      throw new ApiError(403, 'forbidden', 'Your account does not have admin access.')
    }

    attempts.delete(key)
    await recordLogin(user)

    const { token, expiresAt } = issueToken(user)
    res.json({
      token,
      expiresAt,
      user: { email: user.email, name: user.name, role: user.role },
    })
  }),
)

// Everything from here on requires the token.
admin.use(requireAdmin)

admin.get(
  '/session',
  route(async (req, res) => res.json({ ok: true, user: req.admin, ...(await stats()) })),
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
    // Undefined rather than [] when the field is absent: saveProduct
    // treats an empty array as "file this under nothing" and an absent one
    // as "leave the memberships alone".
    origin: raw.origin === 'import' ? 'import' : 'local',
    collections: Array.isArray(raw.collections)
      ? raw.collections.filter((c: unknown): c is string => typeof c === 'string')
      : undefined,
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
  route(async (_req, res) => {
    // Admin sees every product, in every region, regardless of stock.
    res.json(await listProducts({ region: 'us' }))
  }),
)

admin.get(
  '/products/:slug',
  route(async (req, res) => res.json(await getProductBySlug(asString(req.params.slug, 'slug', 120)))),
)

admin.post(
  '/products',
  route(async (req, res) => res.status(201).json(await saveProduct(asProductInput(req.body)))),
)

admin.put(
  '/products/:id',
  route(async (req, res) => {
    const input = asProductInput(req.body)
    input.id = asString(req.params.id, 'id', 80)
    res.json(await saveProduct(input))
  }),
)

admin.delete(
  '/products/:id',
  route(async (req, res) => {
    await deleteProduct(asString(req.params.id, 'id', 80))
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
  route(async (_req, res) => res.json(await listPromos())),
)

admin.post(
  '/promos',
  route(async (req, res) => res.json(await savePromo(asPromoInput(req.body)))),
)

admin.delete(
  '/promos/:code',
  route(async (req, res) => {
    await deletePromo(asString(req.params.code, 'code', 40))
    res.json({ ok: true })
  }),
)

// -------------------------------------------------------------- orders

admin.get(
  '/orders',
  route(async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))
    res.json(await listAllOrders(limit))
  }),
)

admin.patch(
  '/orders/:number',
  route(async (req, res) => {
    const number = asString(req.params.number, 'number', 40)
    res.json(
      await updateOrder(number, {
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
  route(async (req, res) => res.json(await getSettings(asRegion(req.params.region, 'region')))),
)

admin.put(
  '/settings/:region',
  route(async (req, res) =>
    res.json(await putSettings(asRegion(req.params.region, 'region'), asSettings(req.body))),
  ),
)

// -------------------------------------------- categories & collections

function asTaxonomyInput(body: unknown): TaxonomyInput {
  if (typeof body !== 'object' || body === null) {
    throw badRequest('invalid_body', 'Expected a name and an optional description.')
  }
  const raw = body as Record<string, unknown>
  return {
    id: asOptionalString(raw.id, 'id', 80) || undefined,
    label: asString(raw.label, 'label', 60),
    body: asOptionalString(raw.body, 'body', 400) || '',
    position: raw.position === undefined ? 0 : Number(raw.position),
    active: raw.active === undefined ? true : Boolean(raw.active),
  }
}

admin.get(
  '/categories',
  route(async (_req, res) => res.json(await listCategories())),
)
admin.post(
  '/categories',
  route(async (req, res) => res.json(await saveCategory(asTaxonomyInput(req.body)))),
)
admin.delete(
  '/categories/:id',
  route(async (req, res) => {
    await deleteCategory(asString(req.params.id, 'id', 80))
    res.json({ ok: true })
  }),
)

admin.get(
  '/collections',
  route(async (_req, res) => res.json(await listCollections())),
)
admin.post(
  '/collections',
  route(async (req, res) => res.json(await saveCollection(asTaxonomyInput(req.body)))),
)
admin.delete(
  '/collections/:id',
  route(async (req, res) => {
    await deleteCollection(asString(req.params.id, 'id', 80))
    res.json({ ok: true })
  }),
)

// ------------------------------------------------------------- uploads

/**
 * A signature the dashboard uses to post a file straight to Cloudinary.
 *
 * Behind requireAdmin like everything else here, so a signature is only
 * ever minted for somebody already signed in.
 */
admin.get(
  '/uploads/signature',
  route(async (_req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json(signUpload())
  }),
)

/** Lets the media editor show an upload button, or explain its absence. */
admin.get(
  '/uploads/status',
  route(async (_req, res) => res.json({ configured: uploadsConfigured() })),
)
