// ---------------------------------------------------------------------
// The schema, as a string rather than a .sql file read at runtime.
//
// readFileSync would be nicer to read, but the API ships to Vercel as a
// bundle built by tracing imports — a file only referenced by a runtime
// path is not traced, and would be missing in the deployed function. A
// TS module cannot go missing.
// ---------------------------------------------------------------------

export const SCHEMA_SQL = `-- ---------------------------------------------------------------------
-- Orbis, on Postgres.
--
-- Applied on connect (see ensureSchema in src/db.ts) and safe to run
-- again: every statement is IF NOT EXISTS, so a cold start on an
-- already-migrated database is a no-op rather than an error.
--
-- The one structural decision worth explaining: price and stock are per
-- region, and they live in variant_regions — one row per variant per
-- store — rather than in a JSON blob on the variant.
--
-- That is what makes the stock guard safe. Selling the last item has to
-- be atomic, and with a row per region it is exactly:
--
--     UPDATE variant_regions SET stock = stock - $1
--      WHERE variant_id = $2 AND region = $3 AND stock >= $1
--
-- Postgres takes a row lock, the WHERE clause is evaluated against the
-- committed row, and the loser of a race updates nothing. A jsonb column
-- would need a read-modify-write and could not promise that.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS products (
  id           text PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  tagline      text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  highlights   text[] NOT NULL DEFAULT '{}',
  rating_average numeric(3,2),
  rating_count   integer,
  category     text NOT NULL,
  badges       text[] NOT NULL DEFAULT '{}',
  media        jsonb NOT NULL DEFAULT '[]'::jsonb,
  specs        jsonb NOT NULL DEFAULT '[]'::jsonb,
  featured     integer NOT NULL DEFAULT 0,
  weight_grams integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);
CREATE INDEX IF NOT EXISTS products_featured_idx ON products (featured DESC, name);

CREATE TABLE IF NOT EXISTS variants (
  id         text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  sku        text NOT NULL,
  label      text NOT NULL,
  options    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Variants are shown in the order they were entered, so that order is
  -- stored rather than left to whatever the planner returns.
  position   integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS variants_product_idx ON variants (product_id, position);

CREATE TABLE IF NOT EXISTS variant_regions (
  variant_id text NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
  region     text NOT NULL,
  price      integer NOT NULL,
  compare_at integer,
  -- Stock can never go below zero. The guard in the UPDATE is what
  -- enforces it in practice; this is the backstop that turns a bug into
  -- a failed write instead of a negative count.
  stock      integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  PRIMARY KEY (variant_id, region)
);

-- Departments a product belongs to, one each. Seeded from the catalogue
-- in the repo so an existing database keeps working, then editable in the
-- dashboard.
--
-- products.category is deliberately NOT a foreign key here. A category is
-- a label an operator can rename or retire, and a stray delete must never
-- cascade into deleting the products filed under it. The join is by id and
-- a product whose category no longer exists simply stops being filtered
-- into it.
CREATE TABLE IF NOT EXISTS categories (
  id       text PRIMARY KEY,
  label    text NOT NULL,
  blurb    text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  active   boolean NOT NULL DEFAULT true
);

-- Curated groupings that cut across departments — "New in", "Summer",
-- "Last chance". A product can be in any number of them, which is what
-- separates a collection from a category.
CREATE TABLE IF NOT EXISTS collections (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  description text NOT NULL DEFAULT '',
  position    integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);

-- The many-to-many. Both sides cascade: deleting a collection should
-- unfile its products, not orphan rows, and deleting a product should take
-- its memberships with it.
CREATE TABLE IF NOT EXISTS product_collections (
  product_id    text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  collection_id text NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, collection_id)
);

CREATE INDEX IF NOT EXISTS product_collections_collection_idx
  ON product_collections (collection_id);

CREATE TABLE IF NOT EXISTS promos (
  code         text PRIMARY KEY,
  label        text NOT NULL,
  percent_off  integer NOT NULL,
  regions      text[] NOT NULL DEFAULT '{}',
  min_subtotal jsonb NOT NULL DEFAULT '{}'::jsonb,
  active       boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS orders (
  number               text PRIMARY KEY,
  region               text NOT NULL,
  placed_at            timestamptz NOT NULL DEFAULT now(),
  status               text NOT NULL,
  payment_status       text NOT NULL,
  email                text NOT NULL,
  address              jsonb NOT NULL,
  shipping             jsonb NOT NULL,
  payment_method_id    text NOT NULL,
  payment_method_label text NOT NULL,
  payment_reference    text,
  promo_code           text,
  totals               jsonb NOT NULL,
  idempotency_key      text
);

CREATE INDEX IF NOT EXISTS orders_placed_at_idx ON orders (placed_at DESC);
-- Orders are looked up by the email the customer types, which may differ
-- in case from the one they ordered with.
CREATE INDEX IF NOT EXISTS orders_region_email_idx ON orders (region, lower(email));
-- Partial, so the many NULLs do not collide: only orders that actually
-- carry a key take part in the uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_idx
  ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_lines (
  id            bigserial PRIMARY KEY,
  order_number  text NOT NULL REFERENCES orders (number) ON DELETE CASCADE,
  position      integer NOT NULL DEFAULT 0,
  product_id    text NOT NULL,
  product_name  text NOT NULL,
  variant_id    text NOT NULL,
  variant_label text NOT NULL,
  sku           text NOT NULL,
  quantity      integer NOT NULL,
  unit_price    integer NOT NULL,
  line_total    integer NOT NULL
);

CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (order_number, position);

CREATE TABLE IF NOT EXISTS settings (
  id         text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Shoppers. Separate from "users", which is staff: the two have different
-- lifecycles, different volumes and very different blast radii if one is
-- compromised, and merging them is how a customer ends up one role column
-- away from the dashboard.
--
-- Orders are not foreign-keyed to a customer. An order is placed with an
-- email address and stands on its own, whether or not an account existed
-- at the time — so history is matched on the address, which is what the
-- orders_region_email index is already for. Registering later surfaces
-- orders placed before the account existed, which is the behaviour a
-- shopper expects.
CREATE TABLE IF NOT EXISTS customers (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL DEFAULT '',
  -- scrypt:salt:key, same as staff. The plain password is never stored.
  password_hash text NOT NULL,
  -- Which store they signed up in. Only a default; history spans regions.
  region        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_idx ON customers (lower(email));

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL DEFAULT 'Administrator',
  -- scrypt:salt:key. The plain password is never stored.
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'STAFF' CHECK (role IN ('ADMIN', 'STAFF')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- Sign-in lowercases the address before looking it up, so uniqueness has
-- to be case-insensitive too or two accounts could differ only in case.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));
`
