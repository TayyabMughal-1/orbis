import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { ApiError } from './errors'

// ---------------------------------------------------------------------
// Admin authentication.
//
// One operator, one password, no user table. That is the right size for
// a store this size, and it avoids inventing a half-finished accounts
// system that nobody audits.
//
// How it works:
//   • ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) lives in the environment.
//     Without it the admin API is switched off entirely — a deployment
//     that forgets to set it is locked, not wide open.
//   • Login compares in constant time, then returns a signed token.
//   • The token is an HMAC over {issued, expires}. Nothing is stored
//     server-side, so there is no session table to leak and restarting
//     the process does not log you out mid-edit.
//
// What this deliberately is not: multi-user, role-based, or audited.
// If more than one person needs access, or you need to know who changed
// a price, this wants replacing with real accounts.
// ---------------------------------------------------------------------

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

/** Secret for signing tokens. Falls back to the password if unset. */
function signingSecret(): string {
  const secret = process.env.ADMIN_SECRET ?? process.env.ADMIN_PASSWORD_HASH ?? process.env.ADMIN_PASSWORD
  if (!secret) throw new ApiError(503, 'admin_disabled', 'The admin API is not configured.')
  return secret
}

export function adminEnabled(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH)
}

// ------------------------------------------------------------ password

/**
 * Hashes a password for ADMIN_PASSWORD_HASH. Run:
 *   node -e "console.log(require('./server/dist/index.cjs'))"
 * or use the `npm run admin:hash` script.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${derived}`
}

function verifyHashed(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !expected) return false
  const derived = scryptSync(password, salt, 64)
  const expectedBuf = Buffer.from(expected, 'hex')
  if (derived.length !== expectedBuf.length) return false
  return timingSafeEqual(derived, expectedBuf)
}

function verifyPlain(password: string, stored: string): boolean {
  const a = Buffer.from(password)
  const b = Buffer.from(stored)
  // timingSafeEqual throws on a length mismatch, which would itself leak
  // the length — compare padded buffers instead.
  const len = Math.max(a.length, b.length)
  const pa = Buffer.alloc(len)
  const pb = Buffer.alloc(len)
  a.copy(pa)
  b.copy(pb)
  return timingSafeEqual(pa, pb) && a.length === b.length
}

export function checkPassword(password: string): boolean {
  const hashed = process.env.ADMIN_PASSWORD_HASH
  if (hashed) return verifyHashed(password, hashed)

  const plain = process.env.ADMIN_PASSWORD
  if (plain) return verifyPlain(password, plain)

  return false
}

// --------------------------------------------------------------- token

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function sign(payload: string): string {
  return b64url(createHmac('sha256', signingSecret()).update(payload).digest())
}

export function issueToken(now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + TOKEN_TTL_MS
  const payload = b64url(JSON.stringify({ iat: now, exp: expiresAt }))
  return { token: `${payload}.${sign(payload)}`, expiresAt }
}

export function verifyToken(token: string, now = Date.now()): boolean {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false

  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false

  try {
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as { exp?: number }
    return typeof decoded.exp === 'number' && decoded.exp > now
  } catch {
    return false
  }
}

// ---------------------------------------------------------- middleware

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!adminEnabled()) {
    next(
      new ApiError(
        503,
        'admin_disabled',
        'The admin API is disabled because no ADMIN_PASSWORD is configured on the server.',
      ),
    )
    return
  }

  const header = req.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

  if (!token || !verifyToken(token)) {
    next(new ApiError(401, 'unauthorized', 'Sign in again to continue.'))
    return
  }

  next()
}
