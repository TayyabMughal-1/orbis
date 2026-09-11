// Generates an ADMIN_PASSWORD_HASH line for your .env.
//
//   npm run admin:hash -- "your password here"
//
// Storing the hash rather than the password means the plaintext is not
// sitting in an environment variable that every process on the box can
// read, and it is not recoverable from a leaked config.
import { randomBytes, scryptSync } from 'node:crypto'

const password = process.argv[2]

if (!password) {
  console.error('usage: npm run admin:hash -- "your password"')
  process.exit(1)
}

if (password.length < 12) {
  console.error('Use at least 12 characters — this is the only thing guarding your store.')
  process.exit(1)
}

const salt = randomBytes(16).toString('hex')
const derived = scryptSync(password, salt, 64).toString('hex')

console.log('')
console.log('Add this to your .env (and do not commit it):')
console.log('')
console.log(`ADMIN_PASSWORD_HASH=scrypt:${salt}:${derived}`)
console.log('')
