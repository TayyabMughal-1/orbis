// Domain types shared by the mock API, the cart and the UI.
// Everything monetary is an integer in the currency's *minor unit*
// (US cents, AED fils, PKR rupees) — never a float. See lib/money.ts.

import type { RegionCode } from './regions/config.js'

export type PriceByRegion = Record<RegionCode, number>
export type StockByRegion = Record<RegionCode, number>

export type Category = 'figures' | 'homeware' | 'lighting' | 'apparel' | 'prints'

export type MediaItem =
  | { kind: 'video'; src: string }
  | { kind: 'render'; shape: VisualShape; hue: number; accent?: number }

export type VisualShape = 'orb' | 'ring' | 'monolith' | 'prism' | 'wave' | 'grid'

export type VariantOptions = {
  size?: string
  color?: string
  colorHex?: string
}

export type Variant = {
  id: string
  sku: string
  label: string
  options: VariantOptions
  /** Price in minor units of each region's own currency. */
  price: PriceByRegion
  /** Optional "was" price for showing a markdown. */
  compareAt?: Partial<PriceByRegion>
  stock: StockByRegion
}

/** What shoppers left behind. Drives the stars and the rich snippet. */
export type Rating = {
  average: number
  count: number
}

export type Product = {
  id: string
  slug: string
  name: string
  tagline: string
  description: string
  /** Scannable selling points — the bit customers actually read. */
  highlights: string[]
  rating: Rating | null
  category: Category
  /** Short marketing flags rendered as pills on the card. */
  badges?: string[]
  media: MediaItem[]
  specs: { label: string; value: string }[]
  variants: Variant[]
  /** Sort weight for the "featured" ordering; higher shows first. */
  featured?: number
  /** Physical shipping weight in grams — feeds the shipping quote. */
  weightGrams: number
}

// ---------------------------------------------------------------- cart

export type CartLine = {
  productId: string
  variantId: string
  quantity: number
  /** Snapshot so a cart restored from storage still renders if the
   *  catalogue moved on; the API re-prices on quote regardless. */
  addedAt: number
}

/** A cart line joined with live catalogue data, ready to render. */
export type ResolvedLine = {
  line: CartLine
  product: Product
  variant: Variant
  unitPrice: number
  lineTotal: number
  stock: number
}

// ------------------------------------------------------------- address

export type Address = {
  fullName: string
  email: string
  phone: string
  line1: string
  line2: string
  city: string
  /** State / Emirate / Province — label varies by region. */
  region: string
  postalCode: string
  countryCode: string
}

// -------------------------------------------------------------- orders

export type ShippingQuote = {
  id: string
  label: string
  eta: string
  amount: number
  free: boolean
}

export type OrderTotals = {
  currency: string
  subtotal: number
  discount: number
  shipping: number
  /** Payment-method handling fee, e.g. cash on delivery. */
  surcharge: number
  /** Tax actually charged on top of the displayed prices. */
  tax: number
  /** Tax already baked into displayed prices (VAT/GST regions). */
  taxIncluded: number
  taxLabel: string
  taxRate: number
  total: number
}

export type OrderLineSnapshot = {
  productId: string
  productName: string
  variantLabel: string
  sku: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type Order = {
  number: string
  region: RegionCode
  placedAt: string
  status: 'confirmed' | 'processing' | 'shipped'
  /** Whether money has actually moved. Offline methods settle later. */
  paymentStatus: 'paid' | 'pending' | 'due_on_delivery'
  email: string
  address: Address
  shipping: ShippingQuote
  paymentMethodId: string
  paymentMethodLabel: string
  promoCode: string | null
  lines: OrderLineSnapshot[]
  totals: OrderTotals
  /** Set by the API for methods that settle outside the checkout. */
  paymentInstructions?: string | null
}

export type Promo = {
  code: string
  label: string
  /** Percentage off the subtotal, 0-100. */
  percentOff: number
  /** Minimum subtotal (minor units, per region) to qualify. */
  minSubtotal: PriceByRegion
  regions: RegionCode[]
}
