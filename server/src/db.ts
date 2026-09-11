import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { PRODUCTS, PROMOS } from '../../src/api/db'
import { REGION_CODES } from '../../src/regions/config'

// ---------------------------------------------------------------------
// Storage.
//
// SQLite through node:sqlite — built into Node 22.5+, so there is no
// native module to compile and nothing to install. It is a genuinely
// good fit here: a storefront's read path is tiny, writes are rare, and
// stock decrements need a real transaction, which this gives us.
//
// Moving to Postgres later means rewriting this file and repo.ts. The
// route handlers never see SQL.
// ---------------------------------------------------------------------

const DB_PATH = resolve(process.env.ORBIS_DB ?? 'server/data/orbis.db')

let database: DatabaseSync | null = null

export function db(): DatabaseSync {
  if (database) return database

  mkdirSync(dirname(DB_PATH), { recursive: true })
  const conn = new DatabaseSync(DB_PATH)

  // WAL lets reads continue during a write, and NORMAL sync is the right
  // trade for an order table that is also written to disk by the OS.
  conn.exec('PRAGMA journal_mode = WAL')
  conn.exec('PRAGMA synchronous = NORMAL')
  conn.exec('PRAGMA foreign_keys = ON')

  migrate(conn)
  seed(conn)

  database = conn
  return conn
}

export function closeDb(): void {
  database?.close()
  database = null
}

// ------------------------------------------------------------- schema

function migrate(conn: DatabaseSync): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id           TEXT PRIMARY KEY,
      slug         TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      tagline      TEXT NOT NULL,
      description  TEXT NOT NULL,
      category     TEXT NOT NULL,
      badges       TEXT NOT NULL DEFAULT '[]',
      media        TEXT NOT NULL DEFAULT '[]',
      specs        TEXT NOT NULL DEFAULT '[]',
      highlights   TEXT NOT NULL DEFAULT '[]',
      rating_average REAL,
      rating_count   INTEGER,
      featured     INTEGER NOT NULL DEFAULT 0,
      weight_grams INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS variants (
      id         TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku        TEXT NOT NULL UNIQUE,
      label      TEXT NOT NULL,
      options    TEXT NOT NULL DEFAULT '{}',
      position   INTEGER NOT NULL DEFAULT 0
    );

    -- Prices are per region and in that currency's minor unit. There is
    -- no base currency and no FX at runtime, by design.
    CREATE TABLE IF NOT EXISTS variant_prices (
      variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
      region     TEXT NOT NULL,
      price      INTEGER NOT NULL,
      compare_at INTEGER,
      PRIMARY KEY (variant_id, region)
    );

    CREATE TABLE IF NOT EXISTS stock (
      variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
      region     TEXT NOT NULL,
      quantity   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (variant_id, region)
    );

    CREATE TABLE IF NOT EXISTS promos (
      code         TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      percent_off  INTEGER NOT NULL,
      regions      TEXT NOT NULL,
      min_subtotal TEXT NOT NULL,
      active       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS orders (
      number               TEXT PRIMARY KEY,
      region               TEXT NOT NULL,
      placed_at            TEXT NOT NULL,
      status               TEXT NOT NULL,
      payment_status       TEXT NOT NULL,
      email                TEXT NOT NULL,
      address              TEXT NOT NULL,
      shipping             TEXT NOT NULL,
      payment_method_id    TEXT NOT NULL,
      payment_method_label TEXT NOT NULL,
      payment_reference    TEXT,
      promo_code           TEXT,
      totals               TEXT NOT NULL,
      idempotency_key      TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS order_lines (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number  TEXT NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
      product_id    TEXT NOT NULL,
      product_name  TEXT NOT NULL,
      variant_id    TEXT NOT NULL,
      variant_label TEXT NOT NULL,
      sku           TEXT NOT NULL,
      quantity      INTEGER NOT NULL,
      unit_price    INTEGER NOT NULL,
      line_total    INTEGER NOT NULL
    );

    -- Editable storefront copy and per-region overrides, set from the
    -- admin dashboard. A plain key/value table because the shape of what
    -- is editable changes far more often than the schema should.
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_variants_product  ON variants(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_region      ON stock(region);
    CREATE INDEX IF NOT EXISTS idx_orders_region     ON orders(region);
    CREATE INDEX IF NOT EXISTS idx_orders_email      ON orders(email);
    CREATE INDEX IF NOT EXISTS idx_lines_order       ON order_lines(order_number);
  `)

  // `CREATE TABLE IF NOT EXISTS` leaves an existing table untouched, so
  // columns added after a database was first created have to be applied
  // by hand. Cheap to check, and it saves anyone upgrading from having
  // to wipe their orders.
  addColumnIfMissing(conn, 'products', 'highlights', "TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(conn, 'products', 'rating_average', 'REAL')
  addColumnIfMissing(conn, 'products', 'rating_count', 'INTEGER')
}

function addColumnIfMissing(
  conn: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = conn.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]
  if (columns.some((c) => c.name === column)) return
  conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  console.log(`[db] added ${table}.${column}`)
}

// --------------------------------------------------------------- seed

/**
 * Fills an empty database from the catalogue that ships with the repo.
 *
 * It runs once. After the first boot the database is the source of
 * truth — editing src/api/db.ts will not silently rewrite live stock or
 * prices. Use `npm run server:reset` to start over.
 */
function seed(conn: DatabaseSync): void {
  const { count } = conn.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }
  if (count > 0) return

  const insertProduct = conn.prepare(`
    INSERT INTO products (
      id, slug, name, tagline, description, category, badges, media, specs,
      highlights, rating_average, rating_count, featured, weight_grams
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertVariant = conn.prepare(`
    INSERT INTO variants (id, product_id, sku, label, options, position) VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertPrice = conn.prepare(`
    INSERT INTO variant_prices (variant_id, region, price, compare_at) VALUES (?, ?, ?, ?)
  `)
  const insertStock = conn.prepare(`
    INSERT INTO stock (variant_id, region, quantity) VALUES (?, ?, ?)
  `)
  const insertPromo = conn.prepare(`
    INSERT INTO promos (code, label, percent_off, regions, min_subtotal, active) VALUES (?, ?, ?, ?, ?, 1)
  `)

  conn.exec('BEGIN')
  try {
    for (const product of PRODUCTS) {
      insertProduct.run(
        product.id,
        product.slug,
        product.name,
        product.tagline,
        product.description,
        product.category,
        JSON.stringify(product.badges ?? []),
        JSON.stringify(product.media),
        JSON.stringify(product.specs),
        JSON.stringify(product.highlights ?? []),
        product.rating?.average ?? null,
        product.rating?.count ?? null,
        product.featured ?? 0,
        product.weightGrams,
      )

      product.variants.forEach((variant, position) => {
        insertVariant.run(
          variant.id,
          product.id,
          variant.sku,
          variant.label,
          JSON.stringify(variant.options ?? {}),
          position,
        )
        for (const region of REGION_CODES) {
          insertPrice.run(
            variant.id,
            region,
            variant.price[region],
            variant.compareAt?.[region] ?? null,
          )
          insertStock.run(variant.id, region, variant.stock[region])
        }
      })
    }

    for (const promo of PROMOS) {
      insertPromo.run(
        promo.code,
        promo.label,
        promo.percentOff,
        JSON.stringify(promo.regions),
        JSON.stringify(promo.minSubtotal),
      )
    }

    conn.exec('COMMIT')
  } catch (err) {
    conn.exec('ROLLBACK')
    throw err
  }

  console.log(`[db] seeded ${PRODUCTS.length} products and ${PROMOS.length} promo codes`)
}

export { DB_PATH }
