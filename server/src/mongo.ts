import { MongoClient, type Collection, type Db } from 'mongodb'
import { PRODUCTS, PROMOS } from '../../src/api/db'
import type { Address, MediaItem, OrderTotals, ShippingQuote, VariantOptions } from '../../src/types'
import type { RegionCode } from '../../src/regions/config'
import { ApiError } from './errors'

// ---------------------------------------------------------------------
// MongoDB.
//
// Two things drive the shape of this file, both consequences of running
// on serverless:
//
//   1. Connections are cached on globalThis. A Vercel function is frozen
//      between invocations rather than torn down, so the client survives
//      and warm requests reuse it. Without this, every request opens a
//      new connection and a burst of traffic exhausts the Atlas pool.
//
//   2. Seeding is idempotent ($setOnInsert, never $set). Several cold
//      starts can race on a fresh database, and the loser must not
//      overwrite stock the winner has already sold from.
//
// The document model embeds variants inside their product. That is the
// natural shape here — variants are never queried on their own, always
// as part of a product — and it makes the stock decrement a single
// atomic update on one document rather than a join.
// ---------------------------------------------------------------------

export type VariantDoc = {
  id: string
  sku: string
  label: string
  options: VariantOptions
  price: Record<RegionCode, number>
  compareAt?: Partial<Record<RegionCode, number>> | null
  stock: Record<RegionCode, number>
}

export type ProductDoc = {
  _id: string
  slug: string
  name: string
  tagline: string
  description: string
  highlights: string[]
  rating: { average: number; count: number } | null
  category: string
  badges: string[]
  media: MediaItem[]
  specs: { label: string; value: string }[]
  featured: number
  weightGrams: number
  variants: VariantDoc[]
}

export type PromoDoc = {
  _id: string
  label: string
  percentOff: number
  regions: RegionCode[]
  minSubtotal: Record<RegionCode, number>
  active: boolean
}

export type OrderDoc = {
  _id: string
  region: RegionCode
  placedAt: string
  status: string
  paymentStatus: string
  email: string
  address: Address
  shipping: ShippingQuote
  paymentMethodId: string
  paymentMethodLabel: string
  paymentReference: string | null
  promoCode: string | null
  totals: OrderTotals
  lines: {
    productId: string
    productName: string
    variantId: string
    variantLabel: string
    sku: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }[]
  idempotencyKey: string | null
}

export type SettingsDoc = {
  _id: string
  value: Record<string, unknown>
  updatedAt: string
}

// ------------------------------------------------------------ connect

const DB_NAME = process.env.MONGODB_DB ?? 'orbis'

type Cached = { client: MongoClient; db: Db; ready: Promise<void> }

// `var` on globalThis is the documented way to survive the module reload
// that happens between some serverless invocations.
declare global {
  // eslint-disable-next-line no-var
  var __orbisMongo: Cached | undefined
}

function connectionString(): string {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new ApiError(
      503,
      'db_not_configured',
      'MONGODB_URI is not set, so the API has no database to talk to.',
    )
  }
  return uri
}

export function getDb(): Db {
  if (!globalThis.__orbisMongo) throw new ApiError(503, 'db_not_ready', 'The database is not connected yet.')
  return globalThis.__orbisMongo.db
}

export function getClient(): MongoClient {
  if (!globalThis.__orbisMongo) throw new ApiError(503, 'db_not_ready', 'The database is not connected yet.')
  return globalThis.__orbisMongo.client
}

/**
 * Connects, creates indexes and seeds — once per process, and safe to
 * call on every request. Everything that touches the database awaits
 * this first.
 */
export async function connect(): Promise<void> {
  if (globalThis.__orbisMongo) return globalThis.__orbisMongo.ready

  const client = new MongoClient(connectionString(), {
    // Serverless: keep the pool small, fail fast rather than hanging a
    // request for 30 seconds when the cluster is unreachable.
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8000,
  })

  const ready = (async () => {
    await client.connect()
    const db = client.db(DB_NAME)
    await createIndexes(db)
    await seed(db)
  })()

  globalThis.__orbisMongo = { client, db: client.db(DB_NAME), ready }

  try {
    await ready
  } catch (err) {
    // A failed connection must not be cached, or every later request
    // rides the same broken promise until the container is recycled.
    globalThis.__orbisMongo = undefined
    throw err
  }
}

export async function disconnect(): Promise<void> {
  const cached = globalThis.__orbisMongo
  globalThis.__orbisMongo = undefined
  await cached?.client.close()
}

export const products = () => getDb().collection<ProductDoc>('products')
export const promos = () => getDb().collection<PromoDoc>('promos')
export const orders = () => getDb().collection<OrderDoc>('orders')
export const settings = () => getDb().collection<SettingsDoc>('settings')

// ------------------------------------------------------------ indexes

async function createIndexes(db: Db): Promise<void> {
  const p = db.collection<ProductDoc>('products')
  await p.createIndex({ slug: 1 }, { unique: true })
  await p.createIndex({ category: 1, featured: -1 })

  const o = db.collection<OrderDoc>('orders')
  await o.createIndex({ placedAt: -1 })
  await o.createIndex({ region: 1, email: 1 })
  // Partial rather than sparse: only orders that actually carry a key
  // take part, so the many nulls do not collide with each other.
  await o.createIndex(
    { idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
  )
}

// --------------------------------------------------------------- seed

/**
 * Fills an empty database from the catalogue in the repo.
 *
 * $setOnInsert means an existing document is left completely alone, so
 * this is safe to run on every cold start and cannot overwrite prices or
 * stock that have since been edited in the dashboard.
 */
async function seed(db: Db): Promise<void> {
  const collection = db.collection<ProductDoc>('products')
  if ((await collection.estimatedDocumentCount()) > 0) return

  const docs: ProductDoc[] = PRODUCTS.map((product) => ({
    _id: product.id,
    slug: product.slug,
    name: product.name,
    tagline: product.tagline,
    description: product.description,
    highlights: product.highlights ?? [],
    rating: product.rating ?? null,
    category: product.category,
    badges: product.badges ?? [],
    media: product.media,
    specs: product.specs,
    featured: product.featured ?? 0,
    weightGrams: product.weightGrams,
    variants: product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      label: v.label,
      options: v.options ?? {},
      price: { ...v.price },
      compareAt: v.compareAt ?? null,
      stock: { ...v.stock },
    })),
  }))

  await collection.bulkWrite(
    docs.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true },
    })),
    { ordered: false },
  )

  await db.collection<PromoDoc>('promos').bulkWrite(
    PROMOS.map((promo) => ({
      updateOne: {
        filter: { _id: promo.code },
        update: {
          $setOnInsert: {
            _id: promo.code,
            label: promo.label,
            percentOff: promo.percentOff,
            regions: promo.regions,
            minSubtotal: promo.minSubtotal,
            active: true,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  )

  console.log(`[db] seeded ${docs.length} products and ${PROMOS.length} promo codes`)
}

/** True when the cluster answers a ping. Used by /api/health. */
export async function ping(): Promise<boolean> {
  try {
    await getDb().command({ ping: 1 })
    return true
  } catch {
    return false
  }
}

export async function stats(): Promise<{ products: number; variants: number; orders: number }> {
  const docs = await products().find({}, { projection: { variants: 1 } }).toArray()
  return {
    products: docs.length,
    variants: docs.reduce((n, d) => n + (d.variants?.length ?? 0), 0),
    orders: await orders().estimatedDocumentCount(),
  }
}
