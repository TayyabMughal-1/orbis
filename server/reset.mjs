// Drops the catalogue so the next start re-seeds it from src/api/db.ts.
//
// Orders are left alone unless you pass --orders. Deleting the record of
// what people bought should never be a side effect of "reset the demo
// data", so it is opt-in.
import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI
if (!uri) {
  console.error('MONGODB_URI is not set. See .env.example.')
  process.exit(1)
}

const withOrders = process.argv.includes('--orders')
const client = new MongoClient(uri)
await client.connect()
const db = client.db(process.env.MONGODB_DB ?? 'orbis')

const names = ['products', 'promos', 'settings', ...(withOrders ? ['orders'] : [])]
for (const name of names) {
  const dropped = await db.collection(name).drop().then(() => true, () => false)
  console.log(`${dropped ? 'dropped ' : 'not there'}  ${name}`)
}

if (!withOrders) console.log('\norders kept — pass --orders to drop those too')
console.log('next start will re-seed the catalogue')
await client.close()
