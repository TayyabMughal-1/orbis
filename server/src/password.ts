import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------------
// Password hashing.
//
// Its own module rather than part of auth.ts because both auth.ts and
// db.ts need it — auth to check a login, db to hash the seeded
// admin — and having them import each other would be a cycle.
//
// scrypt with a per-password salt. Not bcrypt or argon2 only because
// node:crypto has scrypt built in, and a dependency that has to be
// compiled is a poor trade for one hash.
// ---------------------------------------------------------------------

const KEY_LENGTH = 64

/** Hashes a password into the `scrypt:salt:key` form stored on a user. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex')
  return `scrypt:${salt}:${derived}`
}

/** True when `stored` is a hash of `password`. */
export function verifyHashed(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !expected) return false

  const derived = scryptSync(password, salt, KEY_LENGTH)
  const expectedBuf = Buffer.from(expected, 'hex')
  if (derived.length !== expectedBuf.length) return false
  return timingSafeEqual(derived, expectedBuf)
}

/** Constant-time compare for a password kept in plain text. */
export function verifyPlain(password: string, stored: string): boolean {
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

/**
 * Checks a password against either form — a `scrypt:…` hash or a value
 * kept in plain text, which ADMIN_PASSWORD still allows.
 */
export function verifyPassword(password: string, stored: string): boolean {
  return stored.startsWith('scrypt:') ? verifyHashed(password, stored) : verifyPlain(password, stored)
}

/**
 * A hash of nothing in particular, to check against when the email is
 * unknown. Without it, a missing user returns far faster than a wrong
 * password and the difference tells an attacker which emails exist.
 */
export const DUMMY_HASH = hashPassword(randomBytes(32).toString('hex'))
