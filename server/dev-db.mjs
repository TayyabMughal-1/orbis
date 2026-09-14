// A throwaway MongoDB for local development.
//
// The API needs a real MongoDB now, and signing up for Atlas before you
// can run `npm run dev:all` once is a poor first five minutes. This
// starts one in memory instead — as a single-node replica set, because
// the order transaction needs one.
//
// Nothing it holds survives the process. That is the point: it is for
// developing against, not for keeping orders in.
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
const uri = rs.getUri()

console.log('')
console.log('  Local MongoDB is up. Leave this running, and in another terminal:')
console.log('')
console.log(`    MONGODB_URI="${uri}" npm run dev:all`)
console.log('')
console.log('  PowerShell:')
console.log('')
console.log(`    $env:MONGODB_URI="${uri}"; npm run dev:all`)
console.log('')
console.log('  Everything is wiped when you stop this (Ctrl+C).')
console.log('')

const stop = async () => {
  await rs.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
