// Proves the API actually works against whatever DATABASE_URL points at.
//
//   npm run verify
//
// It boots the real Vercel handler over a local port and exercises the
// paths that are easy to get wrong in a database migration: the schema
// applying, the catalogue seeding, the admin account being created with
// the right role and a hashed password, sign-in succeeding and failing
// for the right reasons, and — the one worth the most — two people
// buying the last item at the same instant.
//
// Nothing here is destructive: it places orders against seeded stock and
// cleans up the rows it created.
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import pg from 'pg'

const require = createRequire(import.meta.url)
const handler = require('./dist/verify-fn.cjs').default

const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env

if (!DATABASE_URL) {
  console.error('\nDATABASE_URL is not set. Put your Supabase connection string in .env first.\n')
  process.exit(1)
}

// The dashboard hands out the URI with a placeholder where the password
// goes. Left in, it fails as an ordinary authentication error several
// seconds later, which reads like a wrong password rather than a
// forgotten edit.
if (/\[YOUR-PASSWORD\]|\[your-password\]/.test(DATABASE_URL)) {
  console.error('\nDATABASE_URL still has the [YOUR-PASSWORD] placeholder in it.')
  console.error('Replace it (brackets included) with your Supabase database password.')
  console.error('Settings -> Database -> Reset database password, if you do not have it.')
  console.error('\nIf the password contains @ : / ? # [ ] % it must be percent-encoded —')
  console.error('an unencoded @ is what broke the previous database connection.\n')
  process.exit(1)
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('\nADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.\n')
  process.exit(1)
}

let passed = 0
let failed = 0
const pass = (name) => {
  passed += 1
  console.log('  ✓ ' + name)
}
const fail = (name, detail) => {
  failed += 1
  console.log('  ✗ ' + name + (detail ? '  — ' + detail : ''))
}
const check = (name, ok, detail) => (ok ? pass(name) : fail(name, detail))
const section = (title) => console.log('\n' + title)

const server = createServer((req, res) => handler(req, res))
await new Promise((resolve) => server.listen(0, resolve))
const base = `http://127.0.0.1:${server.address().port}`

const get = (path, headers = {}) => fetch(base + path, { headers })
const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const sql = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: /\blocalhost\b|\b127\.0\.0\.1\b/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false },
})

try {
  section('Connection')
  const health = await get('/api/health')
  const healthBody = await health.json().catch(() => ({}))
  if (health.status !== 200) {
    fail('GET /api/health', `${health.status} ${JSON.stringify(healthBody).slice(0, 160)}`)
    console.log('\nThe API could not reach the database, so nothing below can run.')
    console.log('Check DATABASE_URL, and that the Supabase project is not paused.\n')
    process.exit(1)
  }
  pass('GET /api/health responds 200')
  check('database answered', healthBody.ok === true)
  check('reports postgres', healthBody.database === 'postgres', String(healthBody.database))

  await sql.connect()

  section('Schema')
  const { rows: tables } = await sql.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  )
  const names = tables.map((t) => t.table_name)
  for (const t of [
    'products',
    'variants',
    'variant_regions',
    'promos',
    'orders',
    'order_lines',
    'settings',
    'users',
  ]) {
    check(`table ${t}`, names.includes(t))
  }

  section('Seed')
  check('14 products seeded', healthBody.products === 14, `got ${healthBody.products}`)
  check('37 variants seeded', healthBody.variants === 37, `got ${healthBody.variants}`)
  const { rows: promoRows } = await sql.query('SELECT count(*)::int AS n FROM promos')
  check('4 promo codes seeded', promoRows[0].n === 4, `got ${promoRows[0].n}`)

  section('Admin user')
  const { rows: users } = await sql.query('SELECT * FROM users WHERE lower(email) = lower($1)', [
    ADMIN_EMAIL,
  ])
  const user = users[0]
  check('admin row exists', Boolean(user))
  check('role is ADMIN', user?.role === 'ADMIN', user?.role)
  check(
    'password is hashed, not plaintext',
    Boolean(user) && user.password_hash.startsWith('scrypt:') && !user.password_hash.includes(ADMIN_PASSWORD),
  )

  section('Sign in')
  const good = await post('/api/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  const session = await good.json().catch(() => ({}))
  check('correct credentials → 200', good.status === 200, String(good.status))
  check('returns a token', Boolean(session.token))
  check('user role is ADMIN', session.user?.role === 'ADMIN')
  check('password hash never returned', !JSON.stringify(session).includes('scrypt:'))

  const wrong = await post('/api/admin/login', { email: ADMIN_EMAIL, password: 'definitely-wrong' })
  check('wrong password → 401', wrong.status === 401, String(wrong.status))
  const unknown = await post('/api/admin/login', { email: 'nobody@example.com', password: ADMIN_PASSWORD })
  const unknownBody = await unknown.json().catch(() => ({}))
  check('unknown email → 401', unknown.status === 401, String(unknown.status))
  check(
    'same message for both (no account enumeration)',
    unknownBody.error?.message === 'That email and password do not match.',
  )

  const auth = { Authorization: 'Bearer ' + session.token }
  check('no token → 401', (await get('/api/admin/products')).status === 401)
  check('valid token → 200', (await get('/api/admin/products', auth)).status === 200)

  section('Storefront reads')
  const list = await get('/api/products?region=pk')
  const products = await list.json().catch(() => [])
  check('GET /api/products?region=pk → 200', list.status === 200, String(list.status))
  check('returns products', Array.isArray(products) && products.length === 14, `got ${products.length}`)
  const withVariants = Array.isArray(products) && products.every((p) => p.variants.length > 0)
  check('every product has variants (the join works)', withVariants)
  const priced =
    Array.isArray(products) &&
    products.every((p) => p.variants.every((v) => typeof v.price.pk === 'number' && typeof v.stock.pk === 'number'))
  check('per-region price and stock reassembled', priced)

  const one = products[0]
  check('GET /api/products/:slug → 200', (await get(`/api/products/${one.slug}`)).status === 200)
  check('GET related → 200', (await get(`/api/products/${one.slug}/related?region=pk`)).status === 200)
  check('GET /api/settings → 200', (await get('/api/settings?region=pk')).status === 200)

  const promo = await post('/api/promos/validate', { code: 'PK20', region: 'pk', subtotal: 5_000_000 })
  check('promo PK20 validates', promo.status === 200, String(promo.status))

  section('The stock guard (the part worth testing)')
  // One variant, one unit of stock, two simultaneous buyers. Exactly one
  // must win. This is the guarantee the Postgres port had to preserve.
  const target = one.variants[0]
  const { rows: before } = await sql.query(
    'SELECT stock FROM variant_regions WHERE variant_id = $1 AND region = $2',
    [target.id, 'pk'],
  )
  const originalStock = before[0]?.stock ?? 0
  await sql.query('UPDATE variant_regions SET stock = 1 WHERE variant_id = $1 AND region = $2', [
    target.id,
    'pk',
  ])

  const order = (key) =>
    post(
      '/api/orders',
      {
        region: 'pk',
        email: 'verify@orbis.test',
        // Shapes come from asAddress() in validate.ts: fullName not name,
        // `region` is the province and must be one the store delivers to,
        // and the phone is validated against /^3\d{9}$/ after the +92 is
        // stripped. postalCode is required for pk. Shipping ids are
        // region-prefixed (pk-standard).
        address: {
          fullName: 'Verify Run',
          email: 'verify@orbis.test',
          line1: '1 Test Street',
          city: 'Lahore',
          region: 'Punjab',
          postalCode: '54000',
          phone: '+92 300 1234567',
        },
        shippingId: 'pk-standard',
        paymentMethodId: 'cod',
        lines: [{ productId: one.id, variantId: target.id, quantity: 1 }],
      },
      { 'Idempotency-Key': key },
    )

  const [a, b] = await Promise.all([order('verify-race-a'), order('verify-race-b')])
  const codes = [a.status, b.status].sort()
  // 201 for the winner (the order was created), 409 for the loser.
  check(
    'exactly one of two concurrent buyers wins',
    codes[0] === 201 && codes[1] === 409,
    `got ${codes.join(' and ')}`,
  )

  const { rows: after } = await sql.query(
    'SELECT stock FROM variant_regions WHERE variant_id = $1 AND region = $2',
    [target.id, 'pk'],
  )
  check('stock landed at 0, never negative', after[0]?.stock === 0, `got ${after[0]?.stock}`)

  const winner = a.status === 201 ? a : b
  const placed = await winner.json().catch(() => ({}))
  check('order has a number', Boolean(placed.number))
  check('order lines came back', Array.isArray(placed.lines) && placed.lines.length === 1)

  const fetched = await get(`/api/orders/${placed.number}`)
  check('GET /api/orders/:number → 200', fetched.status === 200)

  // Idempotency: the same key must return the same order, not a second one.
  const repeat = await order('verify-race-' + (a.status === 201 ? 'a' : 'b'))
  const repeatBody = await repeat.json().catch(() => ({}))
  check('same Idempotency-Key returns the same order', repeatBody.number === placed.number)

  section('Admin writes')
  const settingsPut = await fetch(base + '/api/admin/settings/pk', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ promoStrip: 'verify-run' }),
  })
  check('PUT admin settings → 200', settingsPut.status === 200, String(settingsPut.status))
  const readBack = await get('/api/settings?region=pk')
  const settingsBody = await readBack.json().catch(() => ({}))
  check('setting persisted', settingsBody.promoStrip === 'verify-run')

  check('GET admin orders → 200', (await get('/api/admin/orders', auth)).status === 200)
  check('GET admin promos → 200', (await get('/api/admin/promos', auth)).status === 200)

  section('Cleanup')
  await sql.query('DELETE FROM order_lines WHERE order_number = $1', [placed.number])
  await sql.query('DELETE FROM orders WHERE email = $1', ['verify@orbis.test'])
  await sql.query('UPDATE variant_regions SET stock = $3 WHERE variant_id = $1 AND region = $2', [
    target.id,
    'pk',
    originalStock,
  ])
  await sql.query("DELETE FROM settings WHERE id = 'region:pk'")
  pass('test order removed and stock restored')
} catch (err) {
  fail('unexpected error', err?.message)
  console.error(err)
} finally {
  await sql.end().catch(() => {})
  server.close()
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
