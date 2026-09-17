import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { CATEGORIES, PRODUCTS, PROMOS } from '../../src/api/db.js'
import { ApiError } from './errors.js'
import { hashPassword, verifyPassword } from './password.js'
import { SCHEMA_SQL } from './schema.js'

// ---------------------------------------------------------------------
// Postgres (Supabase).
//
// Three things drive the shape of this file:
//
//   1. The pool is cached on globalThis. A Vercel function is frozen
//      between invocations rather than torn down, so the pool survives
//      and warm requests reuse it. Without this, every request opens a
//      new connection and a burst exhausts the database's limit.
//
//   2. The pool is deliberately small. Supabase's connection pooler is
//      what multiplexes; opening twenty sockets from each of twenty
//      warm containers is how a serverless app runs a database out of
//      connections.
//
//   3. Schema and seed run on first connect, both idempotent, so a
//      fresh project needs no migration step before it works.
// ---------------------------------------------------------------------

const { Pool } = pg
export type PoolClient = pg.PoolClient

export type UserRole = 'ADMIN' | 'STAFF'

export type UserRow = {
  id: string
  email: string
  name: string
  password_hash: string
  role: UserRole
  created_at: Date
  last_login_at: Date | null
}

type Cached = { pool: pg.Pool; ready: Promise<void> }

// `var` on globalThis is the documented way to survive the module reload
// that happens between some serverless invocations.
declare global {
  // eslint-disable-next-line no-var
  var __orbisPg: Cached | undefined
}

function connectionString(): string {
  const uri = process.env.DATABASE_URL
  if (!uri) {
    throw new ApiError(
      503,
      'db_not_configured',
      'DATABASE_URL is not set, so the API has no database to talk to.',
    )
  }
  return uri
}

/**
 * Supabase terminates TLS with a certificate this client has no root for,
 * and bundling Supabase's CA into the repo to then not pin it buys
 * nothing. The connection is still encrypted; it is the certificate chain
 * that goes unverified.
 *
 * Set PGSSL_STRICT=1 to demand a verifiable chain instead — correct for a
 * Postgres whose CA the runtime already trusts.
 */
function sslOptions(uri: string): pg.ConnectionConfig['ssl'] {
  if (/\blocalhost\b|\b127\.0\.0\.1\b/.test(uri) && !/sslmode=require/.test(uri)) return undefined
  return process.env.PGSSL_STRICT ? true : { rejectUnauthorized: false }
}

/**
 * "host/database" from DATABASE_URL, for the startup banner.
 *
 * Splits on the LAST "@" so a password containing one cannot shift where
 * the host is taken from, and returns no part of the credentials — this
 * string is printed to logs.
 */
export function databaseLabel(): string {
  const uri = process.env.DATABASE_URL
  if (!uri) return 'not configured'

  const withoutScheme = uri.replace(/^postgres(?:ql)?:\/\//, '')
  const at = withoutScheme.lastIndexOf('@')
  const hostAndPath = (at === -1 ? withoutScheme : withoutScheme.slice(at + 1)).split('?')[0]
  const slash = hostAndPath.indexOf('/')
  const host = slash === -1 ? hostAndPath : hostAndPath.slice(0, slash)
  const name = slash === -1 ? '' : decodeURIComponent(hostAndPath.slice(slash + 1))
  return `${host}/${name || 'postgres'}`
}

export function getPool(): pg.Pool {
  if (!globalThis.__orbisPg) throw new ApiError(503, 'db_not_ready', 'The database is not connected yet.')
  return globalThis.__orbisPg.pool
}

/** Runs a query on the shared pool. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, values)
}

/**
 * Runs `fn` inside BEGIN/COMMIT on a single connection, rolling back if
 * it throws. Taking one client for the whole transaction is the point:
 * statements sent on different pooled connections are different
 * transactions, which would quietly break the stock guard.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Connects, applies the schema and seeds — once per process, and safe to
 * call on every request. Everything that touches the database awaits
 * this first.
 */
export async function connect(): Promise<void> {
  if (globalThis.__orbisPg) return globalThis.__orbisPg.ready

  const uri = connectionString()
  const pool = new Pool({
    connectionString: uri,
    ssl: sslOptions(uri),
    // Serverless: a small pool per container, and fail fast rather than
    // hanging a request for 30 seconds when the database is unreachable.
    max: Number(process.env.PGPOOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  })

  // An idle client erroring (the pooler recycling it, say) must not take
  // the process down with an unhandled 'error' event.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message))

  const ready = (async () => {
    const info = await pool.query<{ db: string; version: string }>(
      'SELECT current_database() AS db, version() AS version',
    )
    console.log(`[db] postgres is connected ("${info.rows[0].db}")`)
    await ensureSchema(pool)
    await seed(pool)
    await backfillCategories(pool)
    await seedAdminUser(pool)
  })()

  globalThis.__orbisPg = { pool, ready }

  try {
    await ready
  } catch (err) {
    // A failed connection must not be cached, or every later request
    // rides the same broken promise until the container is recycled.
    globalThis.__orbisPg = undefined
    await pool.end().catch(() => {})
    throw err
  }
}

export async function disconnect(): Promise<void> {
  const cached = globalThis.__orbisPg
  globalThis.__orbisPg = undefined
  await cached?.pool.end()
}

// -------------------------------------------------------------- schema

/**
 * Applies the schema. Every statement is IF NOT EXISTS, so this is a
 * no-op against an already-migrated database and needs no migration
 * tool or version table.
 */
async function ensureSchema(pool: pg.Pool): Promise<void> {
  await pool.query(SCHEMA_SQL)
}

// ---------------------------------------------------------------- seed

/**
 * Fills an empty database from the catalogue in the repo.
 *
 * ON CONFLICT DO NOTHING throughout, so an existing row is left
 * completely alone: this is safe to run on every cold start and cannot
 * overwrite prices or stock that have since been edited in the
 * dashboard. Several cold starts racing on a fresh database is fine for
 * the same reason.
 */
async function seed(pool: pg.Pool): Promise<void> {
  // Insert what is missing rather than bailing out on a non-empty table.
  //
  // This used to return early once there were any products at all, which
  // meant a product added to the bundled catalogue reached a fresh
  // database and never reached a live one — the imported range was in
  // the repo and absent from production.
  //
  // The trade, stated plainly: deleting a bundled product through the
  // dashboard brings it back on the next deploy, because the repo still
  // lists it. Remove it from src/api/db.ts as well and it stays gone.
  // Products created in the dashboard are not in the repo, so nothing
  // here touches them.
  const existing = await pool.query<{ id: string }>('SELECT id FROM products')
  const have = new Set(existing.rows.map((r) => r.id))
  const missing = PRODUCTS.filter((p) => !have.has(p.id))
  if (missing.length === 0) return

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const product of missing) {
      await client.query(
        `INSERT INTO products (id, slug, name, tagline, description, highlights,
                               rating_average, rating_count, category, badges,
                               media, specs, featured, weight_grams, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO NOTHING`,
        [
          product.id,
          product.slug,
          product.name,
          product.tagline ?? '',
          product.description ?? '',
          product.highlights ?? [],
          product.rating?.average ?? null,
          product.rating?.count ?? null,
          product.category,
          product.badges ?? [],
          JSON.stringify(product.media ?? []),
          JSON.stringify(product.specs ?? []),
          product.featured ?? 0,
          product.weightGrams ?? 0,
          product.origin ?? 'local',
        ],
      )

      let position = 0
      for (const variant of product.variants) {
        await client.query(
          `INSERT INTO variants (id, product_id, sku, label, options, position)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [
            variant.id,
            product.id,
            variant.sku,
            variant.label,
            JSON.stringify(variant.options ?? {}),
            position,
          ],
        )
        position += 1

        for (const region of Object.keys(variant.price)) {
          await client.query(
            `INSERT INTO variant_regions (variant_id, region, price, compare_at, stock)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (variant_id, region) DO NOTHING`,
            [
              variant.id,
              region,
              (variant.price as Record<string, number>)[region],
              (variant.compareAt as Record<string, number> | null | undefined)?.[region] ?? null,
              (variant.stock as Record<string, number>)[region] ?? 0,
            ],
          )
        }
      }
    }

    // Departments come from the catalogue in the repo so a fresh database
    // has the ones the products already reference. They are editable in
    // the dashboard afterwards; ON CONFLICT DO NOTHING keeps a rename from
    // being undone on the next cold start.
    let categoryPosition = 0
    for (const category of CATEGORIES) {
      await client.query(
        `INSERT INTO categories (id, label, blurb, position, active)
         VALUES ($1,$2,$3,$4,true) ON CONFLICT (id) DO NOTHING`,
        [category.id, category.label, category.blurb ?? '', categoryPosition],
      )
      categoryPosition += 1
    }

    for (const promo of PROMOS) {
      await client.query(
        `INSERT INTO promos (code, label, percent_off, regions, min_subtotal, active)
         VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (code) DO NOTHING`,
        [promo.code, promo.label, promo.percentOff, promo.regions, JSON.stringify(promo.minSubtotal)],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  console.log(`[db] seeded ${missing.length} products from the catalogue`)
}

// --------------------------------------------------------- admin user

/**
 * Creates the ADMIN user named by ADMIN_EMAIL, and keeps its password in
 * step with the environment afterwards.
 *
 * The environment is the source of truth here, unlike the catalogue
 * seed: changing ADMIN_PASSWORD and restarting is the documented way to
 * change the password, so a mismatch is reconciled rather than left
 * alone. The hash is only rewritten when the password has actually
 * changed — hashing produces a fresh salt every time, so writing on
 * every cold start would be a pointless write per container.
 *
 * Doing nothing when ADMIN_EMAIL is unset is deliberate: a deployment
 * that has not configured an admin ends up with no users and a locked
 * dashboard, rather than a default account with a guessable password.
 */
/**
 * Fills the categories table on a database that was seeded before the
 * table existed.
 *
 * seed() returns early once there are products, so it would never run
 * again on a live database — and the dashboard would then offer an empty
 * department list for products that all have one.
 */
async function backfillCategories(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM categories',
  )
  if (Number(rows[0].count) > 0) return

  let position = 0
  for (const category of CATEGORIES) {
    await pool.query(
      `INSERT INTO categories (id, label, blurb, position, active)
       VALUES ($1,$2,$3,$4,true) ON CONFLICT (id) DO NOTHING`,
      [category.id, category.label, category.blurb ?? '', position],
    )
    position += 1
  }
  console.log(`[db] backfilled ${CATEGORIES.length} categories`)
}

async function seedAdminUser(pool: pg.Pool): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!email) return

  // A hash in the environment is used as-is. A plain password is hashed
  // here, so the plaintext still never reaches the database.
  const hashed = process.env.ADMIN_PASSWORD_HASH
  const plain = process.env.ADMIN_PASSWORD
  if (!hashed && !plain) return

  const existing = await pool.query<UserRow>('SELECT * FROM users WHERE lower(email) = $1', [email])
  const user = existing.rows[0]

  if (!user) {
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, role)
       VALUES ($1,$2,$3,$4,'ADMIN')
       ON CONFLICT (lower(email)) DO NOTHING`,
      [
        randomUUID(),
        email,
        process.env.ADMIN_NAME?.trim() || 'Administrator',
        hashed ?? hashPassword(plain as string),
      ],
    )
    console.log(`[db] created ADMIN user ${email}`)
    return
  }

  // Already there. Reconcile only what the environment still declares.
  const stale = hashed
    ? user.password_hash !== hashed
    : !verifyPassword(plain as string, user.password_hash)

  const changed: string[] = []
  if (stale) {
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
      user.id,
      hashed ?? hashPassword(plain as string),
    ])
    changed.push('password_hash')
  }
  if (user.role !== 'ADMIN') {
    await pool.query("UPDATE users SET role = 'ADMIN' WHERE id = $1", [user.id])
    changed.push('role')
  }

  if (changed.length > 0) console.log(`[db] updated ADMIN user ${email} (${changed.join(', ')})`)
}

// --------------------------------------------------------------- stats

/** Counts, and whether the database answers. Used by /api/health. */
export async function stats(): Promise<{ products: number; variants: number; orders: number }> {
  const { rows } = await query<{ products: string; variants: string; orders: string }>(
    `SELECT (SELECT count(*) FROM products)::text AS products,
            (SELECT count(*) FROM variants)::text AS variants,
            (SELECT count(*) FROM orders)::text   AS orders`,
  )
  return {
    products: Number(rows[0].products),
    variants: Number(rows[0].variants),
    orders: Number(rows[0].orders),
  }
}

export async function ping(): Promise<boolean> {
  try {
    await query('SELECT 1')
    return true
  } catch {
    return false
  }
}
