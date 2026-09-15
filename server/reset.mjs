// Drops the catalogue so the next start re-seeds it from src/api/db.ts.
//
// Orders are left alone unless you pass --orders. Deleting the record of
// what people bought should never be a side effect of "reset the demo
// data", so it is opt-in.
//
// Users are never touched: losing the admin account to a data reset
// would lock you out of the dashboard.
import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set. See .env.example.')
  process.exit(1)
}

const withOrders = process.argv.includes('--orders')

const client = new pg.Client({
  connectionString,
  ssl: /\blocalhost\b|\b127\.0\.0\.1\b/.test(connectionString) ? undefined : { rejectUnauthorized: false },
})
await client.connect()

const { rows } = await client.query('SELECT current_database() AS db')
console.log(`resetting database "${rows[0].db}"\n`)

// products cascades to variants and variant_regions; orders cascades to
// order_lines. Both are declared ON DELETE CASCADE in schema.sql.
const tables = ['products', 'promos', 'settings', ...(withOrders ? ['orders'] : [])]

for (const table of tables) {
  try {
    const result = await client.query(`DELETE FROM ${table}`)
    console.log(`cleared   ${table} (${result.rowCount} rows)`)
  } catch (err) {
    console.log(`not there ${table}`)
    void err
  }
}

if (!withOrders) console.log('\norders kept — pass --orders to drop those too')
console.log('next start will re-seed the catalogue')
await client.end()
