# AGENTS.md

Working rules for Orbis. Read this before changing anything.

Orbis is a three-market e-commerce store: one codebase serving `/us`, `/ae` and
`/pk` as if they were separate websites, plus an admin dashboard at `/admin`.

---

## 1. Stack and shape

| Layer | What it is |
| --- | --- |
| Storefront | Vite + React 18 + TypeScript + Tailwind, `react-router-dom` v6 |
| API | Express 4, TypeScript |
| Database | Postgres (Supabase), spoken to directly with `pg` — no ORM |
| Hosting | Vercel: static `dist/` plus **one** serverless function |

```
src/            the storefront and the dashboard (one bundle)
  regions/      the three markets: currency, tax, shipping, address shape
  api/          the only seam between UI and backend
  lib/          pricing, money, storage, hooks
  pages/        routed screens
  components/   presentational; ui/ is the primitive layer
  admin/        dashboard screens

server/src/     the API
  app.ts        routes, CORS, rate limiting, error mapping. Never listens.
  index.ts      local entry point: connect, then listen
  db.ts         pool caching, schema, first-run seed, admin seed
  schema.ts     the tables, as SQL
  repo.ts       reads
  adminRepo.ts  writes, behind the admin token
  service.ts    pricing an order
  auth.ts       sign-in, tokens, requireAdmin
  password.ts   scrypt hashing (its own module to avoid a cycle)
  payments.ts   the gateway seam
  validate.ts   request validation
  errors.ts     one error type, mapped to HTTP status

api/index.ts    the same Express app, as one Vercel function
```

**`app.ts` never calls `listen()`.** `index.ts` listens; the Vercel function does
not. That split is the only reason the same API runs both as a long-lived
process and as a function with no branching inside the routes. Keep it.

---

## 2. Invariants

These are enforced in code and have tests. Breaking one is a bug, not a
refactor.

### The server prices everything

Requests carry **variant ids and quantities and nothing else**. A body that
includes a price is ignored. `priceOrder()` in `service.ts` re-prices from the
database on every quote and every order.

Never add a price, subtotal or total to a request body, and never trust one that
arrives.

### Money is an integer in the currency's minor unit

USD → cents, AED → fils, PKR → whole rupees (`decimals: 0`). Nothing multiplies
or divides a float price. Rates are applied in `src/lib/money.ts` and rounded
back to an integer immediately.

Never introduce a float amount. Never use `toFixed` for arithmetic.

### Stock cannot go negative

The guard is the `WHERE` clause, inside a transaction:

```sql
UPDATE variant_regions SET stock = stock - $1
 WHERE variant_id = $2 AND region = $3 AND stock >= $1
```

Postgres row-locks and evaluates against the committed row, so two people buying
the last item cannot both succeed — the loser updates zero rows and the whole
transaction rolls back. `CHECK (stock >= 0)` is the backstop.

This is why price and stock live in `variant_regions` (a row per variant per
region) rather than a `jsonb` column: a blob would need a read-modify-write and
could not promise this. **Do not denormalise them back.**

### Orders are idempotent, and the check comes first

A retry carrying the same `Idempotency-Key` returns the original order. The
lookup happens at the **top** of `POST /api/orders`, before pricing, stock or
payment.

This ordering was once wrong and it mattered: `assertInStock` rejected the retry
as sold out — the customer's own purchase having taken the last unit — and
`authorizePayment` ran a second time for an order that already existed. Never
move work above that lookup.

### The storefront and the API share pricing

`service.ts` imports `src/lib/pricing.ts` rather than reimplementing it, so a
quote cannot disagree with what the customer was shown. Keep it that way.

---

## 3. Flows

### Region selection

```
/ → RegionGate → detect → redirect to /us, /ae or /pk
```

`src/regions/detect.ts`, in order: an explicit choice in storage → the URL →
`VITE_GEO_ENDPOINT` if set → the browser's timezone and languages. No
third-party lookup, and it works with no server.

Every storefront route is nested under `/:region`. A component must never
hard-code a country: read it from `RegionContext`.

### Browse → cart

```
Home / Catalog → ProductDetail → CartContext → CartDrawer / CartPage
```

The cart lives in `localStorage`, keyed **per region** (`STORAGE_KEYS.cart`), so
switching markets does not carry a PKR basket into the US store. The cart stores
ids and quantities — not prices.

### Checkout

```
Checkout
  → POST /api/quote          server prices the basket
  → POST /api/promos/validate  (optional)
  → POST /api/orders         with an Idempotency-Key
  → 201 → /:region/order/:number
```

`POST /api/orders` does, in order:

1. rate limit
2. **idempotency lookup — returns the original order if this is a retry**
3. validate region, lines, address (`validate.ts`, per-region address shape)
4. `resolveRegionConfig` — dashboard overrides folded into the region defaults
5. `priceOrder` — re-price from the database
6. `assertInStock`
7. `authorizePayment` — the seam in `payments.ts`
8. `createOrder` — transaction: decrement stock, insert order, insert lines

### Order lookup

`GET /api/orders?region=&email=` requires an email. Without one it would hand any
caller the entire order book. Do not add an endpoint that lists orders without a
filter the customer must already know.

### Admin

```
/admin → AdminShell → email + password → POST /api/admin/login
       → token in localStorage → Bearer on every admin request
```

Accounts live in the `users` table: scrypt hash, role `ADMIN` or `STAFF`. The
`ADMIN_EMAIL` account is seeded from the environment on first connect
(`seedAdminUser` in `db.ts`), so a fresh database has exactly one way in and no
default password.

The token is an HMAC over `{sub, email, role, iat, exp}`, 12 hours, nothing
stored server-side. The role is inside the signed token, so authorisation needs
no database round trip. Everything under `/api/admin` requires `ADMIN`; a valid
non-ADMIN account gets **403**, not 401 — signing in again would not help.

With no `ADMIN_EMAIL` set, no user is seeded and the dashboard is locked. A
deployment that forgets is locked, not wide open.

---

## 4. Rules for changing things

### Data access

- Reads go in `repo.ts`, writes in `adminRepo.ts`. The path a customer hits and
  the path an operator hits stay obviously separate.
- **Always parameterise.** `$1`, `$2` — never string-concatenate a value into
  SQL. `ILIKE` patterns must escape `\ % _` first.
- A product is only ever wanted whole, so load it in **one** joined query and
  reassemble in JS (`assemble()` in `repo.ts`). Do not add a query per variant:
  the pooler is a network hop away.
- Multi-statement work that must not half-apply goes through `transaction()` in
  `db.ts`, which takes one client for the whole unit. Statements sent on
  different pooled connections are different transactions.

### Schema

- `schema.ts` is applied on every connect and every statement is
  `IF NOT EXISTS`, so it is a no-op against a migrated database. Keep it that
  way — there is no migration tool and no version table.
- It is a **TypeScript module, not a `.sql` file**. The API ships to Vercel as a
  bundle built by tracing imports; a file only referenced by a runtime
  `readFileSync` path would be missing in the deployed function.
- Seeding uses `ON CONFLICT DO NOTHING`, never `DO UPDATE`. Several cold starts
  can race on a fresh database, and the loser must not overwrite stock the
  winner has already sold from. The admin user is the one deliberate exception:
  the environment is the source of truth for it, so a changed password is
  reconciled.

### Errors

One type, `ApiError(status, code, message)`. `code` is what the storefront
switches on; anything else thrown becomes a 500 with a generic message.

Messages are read by customers. Say what happened and what to do — never leak
internals, stack traces or SQL.

### Validation

Everything from a request goes through `validate.ts`. Address shape, phone
pattern and postal rules are **per region** and come from `regions/config.ts` —
`pk` wants a `Province` from a fixed list and a 5-digit postal code; `us` does
not want the same things. Never hard-code one market's shape.

### Auth

- A wrong email and a wrong password return the **same message** and take the
  same time. Unknown emails are checked against `DUMMY_HASH` so a missing
  account does not return measurably faster. Do not "helpfully" distinguish
  them.
- Never return a password hash in a response.
- Never log a token, a password or `DATABASE_URL`. `databaseLabel()` exists
  precisely so the startup banner can name the database without credentials.

### The frontend seam

Components call `api.*` from `src/api/client.ts` and nothing else. Two
implementations sit behind it: HTTP when `VITE_API_URL` is set, and the
in-browser mock catalogue (`src/api/db.ts`) when it is not, so the storefront
runs standalone for design work. Both satisfy `StoreApi`; a component cannot
tell which it is talking to. Keep new calls behind that type.

`src/api/admin.ts` deliberately has **no** mock — there is no sensible fake for
"save this price".

### Vercel

- `/api/(.*)` is routed to `api/index.ts` by an explicit rewrite in
  `vercel.json`. Do not rely on filesystem routing for it: `api/[...slug].ts`
  was matched as a *single* segment, so `/api/health` worked while
  `/api/admin/login` 404'd and the whole dashboard was unreachable while
  appearing healthy.
- A rewrite may hand the function the destination path instead of the original,
  so `restoreOriginalPath()` puts the browser's path back on `req.url` before
  Express sees it. Both behaviours are covered by tests.
- The pool is cached on `globalThis` — a function is frozen between invocations,
  not torn down, so warm requests reuse it. Keep `PGPOOL_MAX` small: Postgres
  spends real memory per connection and serverless opens one per cold container.
- Use the **transaction pooler** (port 6543), never the direct connection, which
  is IPv6-only.

---

## 5. Commands

```bash
npm run dev          storefront only, against the mock catalogue (no database)
npm run dev:all      API on :8787 + storefront on :5173 proxying /api
npm run verify       full suite against the real DATABASE_URL  ← use this
npm run build        typecheck + build the storefront
npm run api:build    bundle the API
npm run api:check    typecheck the API only
npm run api:reset    drop catalogue rows so the next start re-seeds
npm run admin:hash -- "passphrase"    prints ADMIN_PASSWORD_HASH=...
```

`npm run verify` is the one that matters. It boots the real Vercel handler and
exercises the schema, the seed, the admin account, sign-in, the joins, and two
simultaneous buyers racing for the last unit. **Run it before claiming a change
works.** It cleans up after itself.

---

## 6. Environment

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | **required.** Supabase transaction pooler URI |
| `ADMIN_EMAIL` | required for `/admin` |
| `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` | required for `/admin`; prefer the hash in production |
| `ADMIN_NAME` | display name, default `Administrator` |
| `VITE_SITE_URL` | read at **build** time — canonicals, hreflang, sitemap |
| `VITE_API_URL` | unset ⇒ mock catalogue. Vercel sets it to `/api` automatically |
| `TRUST_PROXY` | `1` behind a proxy (Vercel). Wrong when there is none — a client could forge `X-Forwarded-For` |
| `CORS_ORIGINS` | only when the API is called cross-origin |
| `PGPOOL_MAX` | default 3 |
| `PGSSL_STRICT` | demand a verifiable certificate chain |

Anything prefixed `VITE_` is baked into the browser bundle. **Never put a secret
behind that prefix.**

`.env` is gitignored and `.vercelignore`d. Production values live in the Vercel
dashboard and only reach a **new** deployment — adding a variable does nothing
until you redeploy.

---

## 7. Style

Match the file you are editing. Across the codebase:

- Comments explain **why**, not what. If a line looks odd and is deliberate, say
  what breaks without it. Several of the rules above exist as comments at the
  exact spot they matter — keep them there.
- Name things as the domain does: `variant`, `region`, `promo`, `totals`.
- Prefer a plain function over a class. There is one class in the API (`ApiError`)
  and it earns it.
- No new dependency without a reason the existing ones cannot cover. scrypt is
  used over bcrypt because `node:crypto` already has it.
- TypeScript `strict` is on for both trees. Do not reach for `any` to get past a
  type error; both `npm run build` and `npm run api:check` must stay clean.

## 8. When something does not work

Check in this order — the failure modes have distinct signatures:

| Symptom | Meaning |
| --- | --- |
| `503 db_not_configured` | `DATABASE_URL` unset in that environment |
| `503 db_unavailable` | set, but refused — password, or a paused Supabase project |
| `404` from Vercel (HTML, not JSON) | routing, not the database |
| `401` on a correct password | `ADMIN_EMAIL` differs, or the hash was pasted with its `KEY=` prefix |
| dashboard says "no API behind it" | `apiReachable()` got a non-2xx; the API may be alive but erroring |
| storefront loads but shows no real products | built without `VITE_API_URL`, so it is on the mock catalogue |

`GET /api/health` is the fastest discriminator: JSON with counts means the API
and the database are both fine, and the problem is elsewhere.
