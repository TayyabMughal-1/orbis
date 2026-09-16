import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { ApiError, badRequest, tooMany } from './errors.js'
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js'
import { query } from './db.js'
import { listOrdersForEmail } from './repo.js'
import { asEmail, asOptionalString, asString } from './validate.js'

// ---------------------------------------------------------------------
// Shopper accounts.
//
// Deliberately separate from the staff auth in auth.ts, and not a role on
// the same table. Two reasons: the volumes and lifecycles are nothing
// alike, and a shared table puts a customer one column away from the
// dashboard. The token carries aud:'customer' and requireAdmin only ever
// accepts role 'ADMIN', so neither token can be used against the other's
// routes even though both are HMACs.
//
// An account is a convenience over the orders that already exist, not a
// prerequisite for them. Orders are placed with an email address and
// stand on their own, so history is matched on the address — which means
// registering after ordering surfaces the earlier orders, and checkout
// never requires an account.
// ---------------------------------------------------------------------

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days — a shop, not a bank

export type CustomerRow = {
  id: string
  email: string
  name: string
  password_hash: string
  region: string | null
  created_at: Date
  last_login_at: Date | null
}

export type CustomerClaims = {
  aud: 'customer'
  sub: string
  email: string
  iat: number
  exp: number
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireCustomer once the bearer token checks out. */
      customer?: CustomerClaims
    }
  }
}

/**
 * Signing secret. Distinct from the staff one by construction: even with
 * the same ADMIN_SECRET behind it, a customer token is signed over a
 * different key, so one can never be replayed as the other.
 */
function secret(): string {
  const base = process.env.ADMIN_SECRET ?? process.env.ADMIN_PASSWORD_HASH ?? process.env.ADMIN_PASSWORD
  if (!base) throw new ApiError(503, 'accounts_disabled', 'Accounts are not configured on this server.')
  return `customer:${base}`
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const sign = (payload: string) => b64url(createHmac('sha256', secret()).update(payload).digest())

function issueToken(customer: CustomerRow, now = Date.now()) {
  const expiresAt = now + TOKEN_TTL_MS
  const claims: CustomerClaims = {
    aud: 'customer',
    sub: customer.id,
    email: customer.email,
    iat: now,
    exp: expiresAt,
  }
  const payload = b64url(JSON.stringify(claims))
  return { token: `${payload}.${sign(payload)}`, expiresAt }
}

function readToken(token: string, now = Date.now()): CustomerClaims | null {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const a = Buffer.from(signature)
  const b = Buffer.from(sign(payload))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as CustomerClaims
    if (claims.aud !== 'customer') return null
    if (typeof claims.exp !== 'number' || claims.exp <= now) return null
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') return null
    return claims
  } catch {
    return null
  }
}

export function requireCustomer(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const claims = token ? readToken(token) : null
  if (!claims) {
    next(new ApiError(401, 'unauthorized', 'Sign in to see this.'))
    return
  }
  req.customer = claims
  next()
}

// ------------------------------------------------------------ throttle

const attempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60_000

function throttle(key: string): void {
  const now = Date.now()
  const record = attempts.get(key)
  if (!record || record.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  record.count += 1
  if (record.count > MAX_ATTEMPTS) {
    throw tooMany('Too many attempts. Please wait a few minutes and try again.')
  }
}

// -------------------------------------------------------------- routes

export const account = Router()

const route =
  (handler: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(handler(req, res)).catch(next)
    } catch (err) {
      next(err)
    }
  }

const publicView = (c: CustomerRow) => ({ email: c.email, name: c.name, region: c.region })

async function findByEmail(email: string): Promise<CustomerRow | undefined> {
  const { rows } = await query<CustomerRow>('SELECT * FROM customers WHERE lower(email) = $1', [
    email.trim().toLowerCase(),
  ])
  return rows[0]
}

account.post(
  '/register',
  route(async (req, res) => {
    throttle(req.ip ?? 'unknown')

    const email = asEmail(req.body?.email)
    const password = asString(req.body?.password, 'password', 200)
    const name = asOptionalString(req.body?.name, 'name', 120) || ''
    const region = asOptionalString(req.body?.region, 'region', 4) || null

    if (password.length < 8) {
      throw badRequest('weak_password', 'Use at least 8 characters.')
    }
    if (await findByEmail(email)) {
      // Not a leak worth avoiding: registration has to tell you the address
      // is taken or it cannot work, and a shopper needs to know to sign in.
      throw badRequest('email_taken', 'There is already an account with that email. Sign in instead.')
    }

    const { rows } = await query<CustomerRow>(
      `INSERT INTO customers (id, email, name, password_hash, region)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [randomUUID(), email.trim().toLowerCase(), name, hashPassword(password), region],
    )
    const customer = rows[0]
    res.status(201).json({ ...issueToken(customer), customer: publicView(customer) })
  }),
)

account.post(
  '/login',
  route(async (req, res) => {
    const key = req.ip ?? 'unknown'
    throttle(key)

    const email = asString(req.body?.email, 'email', 200)
    const password = asString(req.body?.password, 'password', 200)

    const customer = await findByEmail(email)
    if (!customer) {
      // Same work as a real check, so a missing account does not answer
      // measurably faster than a wrong password.
      verifyPassword(password, DUMMY_HASH)
      throw new ApiError(401, 'bad_credentials', 'That email and password do not match.')
    }
    if (!verifyPassword(password, customer.password_hash)) {
      throw new ApiError(401, 'bad_credentials', 'That email and password do not match.')
    }

    attempts.delete(key)
    await query('UPDATE customers SET last_login_at = now() WHERE id = $1', [customer.id]).catch(
      () => {},
    )
    res.json({ ...issueToken(customer), customer: publicView(customer) })
  }),
)

account.get(
  '/me',
  requireCustomer,
  route(async (req, res) => {
    const customer = await findByEmail(req.customer!.email)
    if (!customer) throw new ApiError(401, 'unauthorized', 'Sign in again.')
    res.set('Cache-Control', 'no-store')
    res.json(publicView(customer))
  }),
)

account.get(
  '/orders',
  requireCustomer,
  route(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    // Every region: someone who ordered in one store and moved should still
    // see what they bought.
    res.json(await listOrdersForEmail(req.customer!.email))
  }),
)
