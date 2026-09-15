import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { ApiError } from './errors.js'
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js'
import { query, type UserRow, type UserRole } from './db.js'

// ---------------------------------------------------------------------
// Admin authentication.
//
// Accounts live in the `users` table, each with an email, an scrypt
// password hash and a role. The ADMIN named by ADMIN_EMAIL is seeded
// from the environment on connect (see seedAdminUser in db.ts), so a
// fresh database still has exactly one way in and no default password.
//
// How it works:
//   • Login looks the email up, checks the password in constant time,
//     and returns a signed token.
//   • The token is an HMAC over {sub, email, role, issued, expires}.
//     Nothing is stored server-side, so there is no session table to
//     leak and restarting the process does not log anyone out mid-edit.
//   • Because the role is inside the signed token, a request can be
//     authorised without a database round trip.
//
// The trade that comes with a stateless token: revoking one before it
// expires means changing ADMIN_SECRET, which signs out everybody. At
// this size that is the right trade. A sessions table is what to
// reach for when it stops being.
// ---------------------------------------------------------------------

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

export type AdminClaims = {
  /** The user's id. */
  sub: string
  email: string
  role: UserRole
  iat: number
  exp: number
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAdmin once the bearer token checks out. */
      admin?: AdminClaims
    }
  }
}

/** Secret for signing tokens. Falls back to the admin password if unset. */
function signingSecret(): string {
  const secret = process.env.ADMIN_SECRET ?? process.env.ADMIN_PASSWORD_HASH ?? process.env.ADMIN_PASSWORD
  if (!secret) throw new ApiError(503, 'admin_disabled', 'The admin API is not configured.')
  return secret
}

/**
 * Whether the dashboard is switched on at all. Both halves are needed:
 * the email names the account, the password (or its hash) is what seeds
 * it. A deployment that sets neither is locked, not wide open.
 */
export function adminEnabled(): boolean {
  return Boolean(
    process.env.ADMIN_EMAIL && (process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH),
  )
}

export { hashPassword }

// ------------------------------------------------------------- sign in

/**
 * Finds the user and checks the password. Returns null for both "no such
 * email" and "wrong password" — telling those apart is exactly what an
 * attacker enumerating accounts wants.
 *
 * The dummy hash matters for the same reason: without it a missing email
 * returns in microseconds while a real one takes a full scrypt, and the
 * gap is measurable from outside.
 */
export async function authenticate(email: string, password: string): Promise<UserRow | null> {
  const normalised = email.trim().toLowerCase()
  if (!normalised || !password) {
    verifyPassword(password, DUMMY_HASH)
    return null
  }

  const found = await query<UserRow>('SELECT * FROM users WHERE lower(email) = $1', [normalised])
  const user = found.rows[0]
  if (!user) {
    verifyPassword(password, DUMMY_HASH)
    return null
  }

  if (!verifyPassword(password, user.password_hash)) return null
  return user
}

/** Stamps the moment of a successful sign-in. Never blocks the login. */
export async function recordLogin(user: UserRow): Promise<void> {
  try {
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])
  } catch {
    // A dashboard that refuses a correct password because one bookkeeping
    // write failed would be a poor trade.
  }
}

// --------------------------------------------------------------- token

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function sign(payload: string): string {
  return b64url(createHmac('sha256', signingSecret()).update(payload).digest())
}

export function issueToken(user: UserRow, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + TOKEN_TTL_MS
  const claims: AdminClaims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: now,
    exp: expiresAt,
  }
  const payload = b64url(JSON.stringify(claims))
  return { token: `${payload}.${sign(payload)}`, expiresAt }
}

/** The claims carried by a valid, unexpired token, or null. */
export function readToken(token: string, now = Date.now()): AdminClaims | null {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as AdminClaims

    if (typeof claims.exp !== 'number' || claims.exp <= now) return null
    if (typeof claims.sub !== 'string' || typeof claims.role !== 'string') return null
    return claims
  } catch {
    return null
  }
}

// ---------------------------------------------------------- middleware

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!adminEnabled()) {
    next(
      new ApiError(
        503,
        'admin_disabled',
        'The admin API is disabled because no ADMIN_EMAIL and ADMIN_PASSWORD are configured on the server.',
      ),
    )
    return
  }

  const header = req.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const claims = token ? readToken(token) : null

  if (!claims) {
    next(new ApiError(401, 'unauthorized', 'Sign in again to continue.'))
    return
  }

  if (claims.role !== 'ADMIN') {
    // A real account, but not one allowed in here. 403 rather than 401:
    // signing in again will not help.
    next(new ApiError(403, 'forbidden', 'Your account does not have admin access.'))
    return
  }

  req.admin = claims
  next()
}
