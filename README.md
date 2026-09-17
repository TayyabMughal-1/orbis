# Orbis Store — a three-region storefront

One codebase serving three storefronts: **🇺🇸 United States (`/us`)**,
**🇦🇪 United Arab Emirates (`/ae`)** and **🇵🇰 Pakistan (`/pk`)**, plus a real
API behind them.

Orbis is the little astronaut in the films — the character the whole range is
built around. Figures of him are the flagship; the homeware, lighting, apparel
and prints are the world he lives in.

Each store behaves like its own website — its own currency, tax treatment,
delivery tiers, payment methods, address form, legal entity and stock — while
sharing one catalogue, one design system and one deployment.

```bash
npm install

npm run dev        # storefront only, on the in-browser mock catalogue
npm run dev:all    # storefront + API together (this is the real thing)

npm run build      # typecheck + bundle + generate sitemap.xml and robots.txt
npm run api        # build and run the API on its own
```

`npm run dev` works with no backend at all — handy for design work. `npm run
dev:all` starts the API on :8787, points the storefront at it through the Vite
proxy, and is what you want for anything involving orders.

---

## How the three stores differ

Everything below comes from a single entry in [`src/regions/config.ts`](src/regions/config.ts).
Adding a fourth market means adding one object there; no component and no API
route hard-codes a country.

|                   | 🇺🇸 United States            | 🇦🇪 United Arab Emirates          | 🇵🇰 Pakistan                          |
| ----------------- | ---------------------------- | --------------------------------- | ------------------------------------- |
| Currency          | USD, 2 decimals              | AED, 2 decimals                   | PKR, **0 decimals** (whole rupees)    |
| Tax               | Sales tax **added at checkout**, rate by state (CA 8.75%, OR 0%…) | 5% VAT **already in the price** | 18% GST **already in the price** |
| Delivery          | Standard / Express / Overnight, free over $150 | Standard / Next day / Same day, free over AED 400 | Standard / Express, free over Rs 25,000 |
| Payment           | Card, PayPal, Apple Pay, Affirm | Card, Apple Pay, Tabby, Tamara, Cash on delivery | Cash on delivery, Easypaisa, JazzCash, Card, Bank transfer |
| Address           | State + ZIP (`94107`)        | Emirate + optional PO Box         | Province + postal code (`54000`)      |
| Phone             | `+1` 10 digits               | `+971` `5XXXXXXXX`                | `+92` `3XXXXXXXXX`                    |
| Returns           | 30 days                      | 14 days                           | 7 days                                |
| Legal entity      | Orbis Store Inc.             | Orbis Store Trading L.L.C.        | Orbis Store (Pvt.) Ltd.               |

Two consequences worth knowing:

- **Prices are set per market, not converted.** Every variant carries three real
  prices. Real stores price each market deliberately — landed cost, local
  competition, round local numbers — rather than running today's FX rate over a
  USD list price.
- **Carts and stock are per store.** A basket is priced in one currency and
  reserved against one warehouse, so `/us` and `/ae` keep separate baskets and
  separate stock rows. Selling the last UAE hoodie does not affect Pakistan.

## How a visitor lands in the right store

1. An explicit `/us`, `/ae` or `/pk` in the URL always wins.
2. Otherwise, a previously chosen store (remembered in `localStorage`).
3. Otherwise, `GET /api/geo`, which reports the country your CDN already
   resolved — no third-party IP lookup, no visitor data leaving your origin.
4. Otherwise the browser's own timezone and languages.
5. Otherwise `DEFAULT_REGION` (US).

If someone opens a `/us` link from Karachi, a dismissible bar **offers** the
Pakistan store. It never redirects them: being bounced to another site mid-click
is hostile, and they may be buying a gift for somewhere else. Once they choose or
dismiss, they are not asked again.

---

## The backend

`server/` is an Express + Postgres service, hosted on Supabase. Postgres because the whole
thing has to run on Vercel: a serverless function has no filesystem worth
keeping, so the database has to live somewhere else. Supabase's free tier is enough.

```
server/src/
  app.ts        the Express app — routes, CORS, rate limiting, error mapping
  index.ts      local entry point: connect, then listen on a port
  db.ts         pool caching, schema, first-run seed
  schema.ts     the tables, as SQL
  repo.ts       reads
  adminRepo.ts  writes, behind the admin token
  service.ts    pricing an order (shares src/lib/pricing.ts with the web app)
  payments.ts   the gateway seam
  validate.ts   request validation
  errors.ts     one error type, mapped to HTTP status

api/
  [...slug].ts  the same app, as one Vercel serverless function
```

`app.ts` holds the app and never calls `listen()`. `index.ts` listens; the Vercel
function does not. That split is the only reason the same API can run both as a
long-lived process and as a function, with no branching inside the routes.

Two details exist purely because of serverless:

- **The client is cached on `globalThis`.** Vercel freezes a container between
  invocations rather than destroying it, so a warm request reuses the existing
  connection. Without this, a burst of traffic opens a connection per request and
  exhausts the connection limit.
- **Seeding uses `$setOnInsert`, never `$set`.** Several cold starts can race on
  a fresh database, and the loser must not overwrite stock the winner has already
  sold from.

Stock is decremented inside a transaction, and the guard is in the update filter
itself — a variant only matches while it still holds enough stock. Two people
buying the last item cannot both succeed: the loser's update matches nothing and
the whole transaction is abandoned. Postgres takes a row lock and evaluates the
`WHERE` against the committed row, so the loser updates nothing and rolls back.

| Method | Path | |
| --- | --- | --- |
| GET  | `/api/health` | counts, and whether the database answers |
| GET  | `/api/geo` | country from the CDN's geo header |
| GET  | `/api/products` | `region`, `category`, `sort`, `search`, `inStockOnly`, `limit` |
| GET  | `/api/products/:slug` | one product |
| GET  | `/api/products/:slug/related` | in-stock suggestions |
| POST | `/api/promos/validate` | code + region + subtotal |
| POST | `/api/quote` | totals for a basket |
| POST | `/api/orders` | place an order (honours `Idempotency-Key`) |
| GET  | `/api/orders/:number` | one order |
| GET  | `/api/orders?region=&email=` | a customer's orders |
| GET  | `/api/settings?region=` | the editable copy and delivery prices for a store |
| POST | `/api/admin/login` | exchange the password for a token |
| *    | `/api/admin/*` | products, promos, orders and settings — all require the token |

Four rules the service actually enforces, rather than merely intending to:

- **The server prices everything.** Requests carry variant ids and quantities and
  nothing else. A body that includes a price is ignored — there is a test for it.
  Tax, shipping and discount maths are the same functions the storefront renders
  with, imported from `src/lib/pricing.ts` rather than reimplemented, so a quote
  cannot disagree with what the customer was shown.
- **Stock cannot go negative.** The decrement is `UPDATE … WHERE quantity >= ?`
  inside a transaction with the insert. Two people buying the last hoodie at the
  same instant: one gets it, the other gets a 409.
- **Orders are idempotent.** Send an `Idempotency-Key` and a retry after a
  dropped response returns the original order instead of placing a second one.
  The checkout page generates one per attempt.
- **Listing orders needs an email.** Without that guard the endpoint would hand
  any caller the entire order book.

### The dashboard

`/admin` is a working back office: add and edit products, set prices and stock
per region, run promo codes, fulfil orders, and change each store's copy,
delivery prices and tax rate.

Sign in with an email and a password. Accounts live in the `users` collection,
each with an scrypt password hash and a role; the ADMIN named by `ADMIN_EMAIL` is
created from the environment the first time the API connects.

```bash
#   1. in .env in the project root:
#        ADMIN_EMAIL=admin@orbisstore.com
#        ADMIN_PASSWORD=a long passphrase
#   2. npm run dev:all
#   3. open http://localhost:5173/admin
```

`ADMIN_PASSWORD_HASH` may be used instead of `ADMIN_PASSWORD`, and is what to
prefer in production — the plaintext then exists nowhere:

```bash
npm run admin:hash -- "a long passphrase"   # prints ADMIN_PASSWORD_HASH=...
```

The environment stays the source of truth: change the password there, restart,
and the stored hash is brought into line. The hash is only rewritten when the
password has actually changed, so this costs nothing on an ordinary cold start.
Changing the email creates a second account rather than renaming the first.

The API reads `.env` itself (via Node's `--env-file-if-exists`), so there is no
dotenv dependency and nothing to import. In production, set the variables the way
your host does it instead.

**It is off until `ADMIN_EMAIL` and one of `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH`
are set on the API.** A deployment that forgets is locked, not wide open — no
user is seeded at all, so there is no default account to guess. Login is
throttled to eight attempts per IP per fifteen minutes and issues a signed token
carrying the user's id and role that lasts twelve hours; there is no session
table, so a restart does not sign you out. A wrong email and a wrong password
give the same message and take the same time, so the endpoint cannot be used to
discover which addresses have accounts.

Roles are `ADMIN` and `STAFF`. Everything under `/api/admin` requires `ADMIN`;
`STAFF` exists so the field is real rather than decorative, and earns its keep
the first time a route needs to be narrower than the rest.

| Screen | What it does |
| --- | --- |
| **Products** | Create, edit and delete products. Each variant carries a price and a stock count for all three stores, typed the way a customer reads them. |
| **Promo codes** | Percentage off, which stores it works in, minimum spend per store, live or paused. |
| **Orders** | Every order with its lines and totals. Move fulfilment and payment status. |
| **Store settings** | Per store: promo strip, hero eyebrow, support details, delivery options and prices, and the tax rate. |

Two things worth understanding:

- **Settings change what customers are charged, not just what they read.** The
  tax rate and delivery prices set here are what `POST /api/quote` and
  `POST /api/orders` price against — the server resolves them before doing any
  maths, so a stale browser tab cannot check out at yesterday's rate.
- **Anything left blank follows the default** in `src/regions/config.ts`. The
  overrides are a patch, not a copy, so fields added to the config later appear
  without touching the database.

It is one shared password with no per-user accounts and no audit trail. That is
the right size for a single operator; if more than one person needs access, or
you need to know who changed a price, replace it with real accounts.

### Data

The first connection seeds the database from `src/api/db.ts` and then leaves it
alone — editing that file will not silently rewrite live stock or prices. To
re-seed, run `npm run api:reset` and restart.

The catalogue lives in Postgres from then on. Variants are rows of their
product, which is the natural shape here: they are never queried on their own,
and it makes the stock decrement one atomic update on one document rather than a
join. Prices and stock are keyed by region, so a market can be repriced or
restocked without touching the others.

### Payments

Checkout records a real order with correct totals. What happens next depends on
the method, and the confirmation page says which:

- **Cash on delivery and bank transfer are complete.** No gateway is involved;
  the order is recorded as payable later, which is the whole flow.
- **Card and wallet methods create the order with `paymentStatus: 'pending'` and
  charge nothing.** The customer is told plainly that no card was charged. This
  is deliberate — taking card details needs a secret key, which is why the seam
  lives in `server/src/payments.ts` and not in the browser.

To go live, implement `authorizePayment` for a market: Stripe or PayPal for the
US; Network International, Telr, Checkout.com, Tabby or Tamara for the UAE;
Easypaisa or JazzCash for Pakistan. The amount passed in is the server's own
quote, never the request body's.

### Swapping the backend out

`src/api/client.ts` is the only file the UI imports. It picks the HTTP client
when `VITE_API_URL` is set and the in-browser mock when it is not — both satisfy
the same `StoreApi` type, so no component can tell which it is talking to. Point
it at a different service, or replace `repo.ts` with Postgres, and nothing above
it changes.

---

## Architecture

```
src/
  regions/     config.ts    the three storefronts — the file that matters most
               detect.ts    timezone/language/geo resolution
  api/         client.ts    the ONLY seam the UI talks to
               server.ts    in-browser mock, used when there is no API
               db.ts        seed catalogue
  lib/         money.ts     integer minor-unit maths + Intl formatting
               pricing.ts   one place that decides an order's numbers
               seo.tsx      title/canonical/hreflang/OG/JSON-LD
  context/     CartContext  per-region cart, persisted
  components/  header, footer, cart drawer, cards, toasts, 3D carousel
  pages/       home, catalog, product, cart, checkout, confirmation, help
```

**Money is never a float.** Every amount is an integer in the currency's minor
unit — US cents, AED fils, whole PKR rupees. Rates are applied and rounded in
`lib/money.ts` and nowhere else. `AED 105` at 5% VAT contains `AED 5.00` of VAT,
not `AED 5.25`.

---

## SEO

Three storefronts selling the same catalogue in near-identical English is exactly
the shape a search engine reads as duplicate content, with one market
cannibalising the others. So every page emits:

- a **self-referencing canonical** for its own region
- **hreflang alternates** to the same page in the other two, plus `x-default`
- Open Graph and Twitter tags, with a **per-region share card** (`/og-ae.png` and
  friends) so a link shared from the UAE store previews in AED
- **JSON-LD**: `OnlineStore`, `WebSite` + `SearchAction`, `BreadcrumbList`,
  `ItemList` on category pages, `Product` with `AggregateOffer` and
  `MerchantReturnPolicy` on product pages, `FAQPage` on `/help`

`npm run build` also generates `sitemap.xml` — all 69 region × page URLs, each
listing its siblings as `xhtml:link` alternates — and a `robots.txt` that keeps
carts, checkouts, orders and search-result pages out of the index. Both come from
the same `REGIONS` list as the hreflang tags, so they cannot drift.

> **One honest caveat.** This is a client-rendered SPA, so those tags are written
> by JavaScript after load. Google renders JS and will see them; many other
> crawlers and most social-preview scrapers will not. For a production storefront,
> prerender or server-render these routes. `src/lib/seo.tsx` is written so that
> moving to SSR needs no change at any call site.

Set `VITE_SITE_URL` to your real domain before building — canonicals, hreflang,
OG URLs and the sitemap all derive from it.

---

## Motion and accessibility

Animation shows state rather than decorating: the hero staggers in, sections
reveal once on scroll via one self-disconnecting `IntersectionObserver` each, the
cart badge pops on every add, and on phones a buy bar slides up once the real
button scrolls away.

The departments section is a 3D cylinder carousel — five cards with real
volumetric thickness rolling past the camera, each with a video front and a
blurred back, tilting with the cursor on an inertia delay. It runs in one
`requestAnimationFrame` loop writing transforms straight to the DOM, and parks
itself entirely whenever the section is off-screen. Every card is still a real
`<Link>`, with a plain row of department links beneath it.

All of it collapses under `prefers-reduced-motion: reduce` — transitions are
neutralised in `index.css`, `.reveal` elements start visible, and the carousel
stops auto-advancing and becomes a stepper the visitor drives.

Also: a skip-to-content link, a focus-trapped cart drawer that restores page
scroll, visible focus rings, `aria-live` toasts, real labels on every field, and
inline validation that explains the local format (*That does not look like a
United Arab Emirates number. Example: 50 123 4567*).

---

## Deploying

Everything — storefront, API and admin dashboard — runs on Vercel as one
project. The only thing hosted elsewhere is the database.

### Running it locally

The API needs a Postgres. Point `DATABASE_URL` at the same Supabase project you
deploy against — the free tier is fine to develop against directly — or at any
local Postgres:

```bash
# .env
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Then, in another terminal, with that URI in the environment:

```bash
npm run dev:all       # API on :8787, storefront on :5173 proxying /api
```

The schema is applied on first connect, so there is no migration step to run.
`npm run dev` on its own skips the API
entirely and runs the storefront against the catalogue bundled into
`src/api/db.ts` — enough for design work, and it needs no database at all.

### 1. A database

[Supabase](https://supabase.com/dashboard) free tier is enough.

1. Create a cluster.
2. **Database Access** → add a user, copy the password.
3. **Network Access** → allow `0.0.0.0/0`.
4. **Connect → Drivers** → copy the connection string, paste the password in.

Step 3 looks alarming and is not optional: serverless functions get a different
outbound IP on every cold start, so there is no address to allow-list. The
database is still protected by the user, the password and TLS.

If the password contains `@ : / ? # [ ] %`, percent-encode it or the URI will not
parse.

### 2. The project

Import the repo and deploy. `vercel.json` handles the rest — framework `vite`,
build `npm run build:live`, output `dist`, `api/[...slug].ts` as the function,
and a rewrite that sends everything *except* `/api/*` to `index.html` so a hard
refresh on `/ae/product/halo-pendant` serves the app rather than a 404.

**Root Directory** must be the folder holding `package.json`. If you pushed the
parent folder rather than this one, set it in Project → Settings → General.

### 3. Environment variables

In Project → Settings → Environment Variables:

| Variable | Value | |
| --- | --- | --- |
| `DATABASE_URL` | Supabase → Connect → Session pooler URI, password filled in | **required** |
| `ADMIN_EMAIL` | the admin account's email | required for `/admin` |
| `ADMIN_PASSWORD_HASH` | output of `npm run admin:hash -- "your passphrase"` | required for `/admin` |
| `ADMIN_NAME` | display name, default `Administrator` | optional |
| `VITE_SITE_URL` | `https://your-domain.com` | canonicals, hreflang, sitemap |
| `CORS_ORIGINS` | only if the API is called cross-origin | optional |
| `CLOUDINARY_CLOUD_NAME` | from the Cloudinary dashboard | optional — enables uploads |
| `CLOUDINARY_API_KEY` | same place | optional |
| `CLOUDINARY_API_SECRET` | same place — **server only, never `VITE_`** | optional |

`VITE_SITE_URL` is read at **build** time, so changing it needs a redeploy.
`DATABASE_URL`, `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` are read at request time.

Use the **Session pooler** connection string, not the direct one. Serverless
functions open a connection per cold container, and Postgres — unlike Mongo —
spends real memory per connection; the pooler is what stops a traffic spike from
exhausting the project's limit. The API keeps its own pool small for the same
reason (`PGPOOL_MAX`, default 3).

TLS is on, but the certificate chain is not verified, because Supabase presents a
CA this client has no root for. Set `PGSSL_STRICT=1` to demand a verifiable chain
when pointing at a Postgres whose CA the runtime already trusts.

### Product images

The dashboard can either take a file or a URL. Uploads need three values
from **Cloudinary → Settings → API Keys**, set on the server:

```
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=...
```

None of them may carry a `VITE_` prefix. Anything prefixed that way is
compiled into the browser bundle, and the secret is what stops strangers
uploading to your account.

The file does not pass through this API. The dashboard asks it for a
signature, then posts the bytes straight to Cloudinary — which is the
only reason a 40MB video works at all, since a serverless function would
have to hold the whole thing in memory inside a fifteen-second budget.

Signed rather than an unsigned preset on purpose: an unsigned preset is a
public string that lets anyone who reads the JavaScript upload to your
account until you delete it. A signature is minted per upload, only for a
signed-in admin, and is scoped to the `orbis/products` folder.

Leave them unset and the upload button explains itself; pasting a URL
still works.

Set `ADMIN_PASSWORD_HASH` rather than `ADMIN_PASSWORD` — the hash is what the
server compares against, and the plaintext then exists nowhere. Without either,
`/admin` stays locked: a deployment that forgets is locked, not wide open.

### What happens on the first request

A cold container connects, creates indexes, seeds the catalogue if the database
is empty, and caches the client. That first request is slower; the rest reuse the
connection. Seeding never overwrites an existing document, so this is safe on
every cold start and safe when several race.

### If something is wrong

- **`/api/health` returns 503 `db_not_configured`** — `DATABASE_URL` is not set on
  the environment you are looking at. Vercel keeps Production, Preview and
  Development separate; set it on all three.
- **503 `db_unavailable`** — the URI is set but the cluster refused. Almost
  always the password, or Network Access not allowing `0.0.0.0/0`.
- **The shop loads with no products** — the build ran without `VITE_API_URL`.
  `vercel.json` sets it via `npm run build:live`; if you overrode the build
  command in the dashboard, that is why.
- **`/admin` says the email and password do not match** — `ADMIN_PASSWORD_HASH`
  is missing, or was pasted with the `ADMIN_PASSWORD_HASH=` prefix included in
  the value; or `ADMIN_EMAIL` differs from the address being typed. Check the
  `users` collection: the account is created on the first connect after both are
  set, and the startup log says `created ADMIN user <email>` when it happens.

### Running it anywhere else

`npm run api:build` produces `server/dist/index.cjs`; run it with plain `node`.
Set `NODE_ENV=production`, `CORS_ORIGINS` to your storefront's origin,
`DATABASE_URL`, and `TRUST_PROXY=1` if anything sits in front of it. The same
database works for both — nothing about the API assumes serverless.

`public/_redirects` covers Netlify. For nginx:

```nginx
location / { try_files $uri $uri/ /index.html; }
```

To run the three stores on separate domains instead of paths, point each at the
same build and rewrite `/` to `/us`, `/ae` or `/pk` at the edge — the router
handles everything after that.

## Demo promo codes

`ORBIS10` (all stores, 10%) · `GULF15` (UAE only, 15%) · `PK20` (Pakistan, 20%
over Rs 20,000) · `FREIGHT` (US only, 5% over $100). Codes are validated
server-side against both the region and the basket, so `GULF15` is refused on the
US store.

## The catalogue

Fourteen products across five departments, each priced in three currencies:

| Department | Products |
| --- | --- |
| **Figures** | Orbis Classic (180mm), Orbis Explorer (flocked helmet, 200mm), Orbis Mini (120mm), Orbis Brass Keyring |
| **Homeware** | Monolith Bookends, Drift Vessel, Parallax Desk Clock |
| **Lighting** | Meridian Table Light, Halo Pendant |
| **Apparel** | Signal Hoodie, Deep Field Tee, Vector Cap |
| **Prints** | Orbis Portrait, Star Chart Set |

Catalogue copy lives in `src/api/db.ts`. It seeds the database on the API's first
boot and doubles as the standalone catalogue when the storefront runs without a
backend.

## Notes on the sample data

The catalogue is fictional, and so are the company registration numbers, support
numbers and warehouse addresses in `src/regions/config.ts` — replace them before
going anywhere near a real customer. Product imagery is either the CloudFront
video assets or deterministic SVG renders drawn in `ProductVisual.tsx`; swap
`MediaItem.kind: 'render'` for real photography and nothing else changes.

Selling into these three markets carries real obligations — VAT registration in
the UAE, sales-tax nexus in the US, GST and consumer-protection rules in
Pakistan. The tax rates here are plausible defaults, not advice.
