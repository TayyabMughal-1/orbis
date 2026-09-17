// ---------------------------------------------------------------------
// The three storefronts.
//
// Everything that makes /us, /ae and /pk behave like separate websites
// lives in this file: currency, tax treatment, shipping tiers, payment
// methods, address shape, and the legal/contact block in the footer.
// Adding a fourth market should mean adding one entry here — nothing in
// the components hard-codes a country.
// ---------------------------------------------------------------------

export const REGION_CODES = ['us', 'ae', 'pk'] as const
export type RegionCode = (typeof REGION_CODES)[number]

export const DEFAULT_REGION: RegionCode = 'us'

export function isRegionCode(value: unknown): value is RegionCode {
  return typeof value === 'string' && (REGION_CODES as readonly string[]).includes(value)
}

export type Currency = {
  code: string
  symbol: string
  /** Digits after the decimal point. PKR is quoted in whole rupees. */
  decimals: number
}

export type ShippingTier = {
  id: string
  label: string
  eta: string
  /**
   * The same window as `eta`, in business days, so the product page can
   * show a real date ("get it by Tue, 16 Sep") instead of asking the
   * customer to do the arithmetic. Kept alongside the prose rather than
   * parsed out of it.
   */
  etaDays: [min: number, max: number]
  /** Price in minor units; waived when the free threshold is met. */
  amount: number
  /** Subtotal at or above which this tier costs nothing. */
  freeOver?: number
}

export type PaymentMethod = {
  id: string
  label: string
  description: string
  /** Extra charge (minor units) — e.g. cash-on-delivery handling. */
  surcharge?: number
  /** Shown when the method settles offline rather than at checkout. */
  offline?: boolean
}

export type AddressFormat = {
  regionLabel: string
  regionOptions: string[]
  postalLabel: string
  /** null = the field is optional in this market. */
  postalPattern: RegExp | null
  postalPlaceholder: string
  phonePrefix: string
  phonePattern: RegExp
  phonePlaceholder: string
}

export type RegionConfig = {
  code: RegionCode
  /** Storefront name shown in the header lockup. */
  storeName: string
  country: string
  countryCode: string
  flag: string
  locale: string
  currency: Currency
  taxLabel: string
  /** Flat rate used unless taxRateFor() overrides it by sub-region. */
  taxRate: number
  taxRateBySubRegion?: Record<string, number>
  /** True where the law expects prices displayed tax-inclusive. */
  taxIncludedInPrice: boolean
  /** Line printed under prices, e.g. "Incl. 5% VAT". */
  taxNote: string
  shipping: ShippingTier[]
  paymentMethods: PaymentMethod[]
  address: AddressFormat
  support: { email: string; phone: string; hours: string }
  entity: { name: string; addressLines: string[]; registration: string }
  policy: { returnsDays: number; dutiesNote: string }
  /** Merchandising copy that differs by market. */
  hero: { eyebrow: string; promo: string }
  /**
   * How this storefront looks and sounds.
   *
   * accent retints the whole UI: it is written to --accent and every
   * text-accent, bg-accent and border-accent in the app follows it. All
   * three clear 4.5:1 against white in both directions, because the
   * accent is link and price colour as well as a button fill.
   *
   * motif is a decorative fill drawn behind the hero badge — a geometric
   * star for the Gulf, block stripes for the States, a truck-art bloom
   * for Pakistan. Decoration only; nothing reads it for meaning.
   */
  theme: {
    /** Space-separated RGB channels, for rgb(var(--accent) / alpha). */
    accent: string
    accentHex: string
    motif: 'stripes' | 'geometric' | 'bloom'
    /** One line in the local register, under the hero copy. */
    greeting: string
  }
}

const US_STATE_TAX: Record<string, number> = {
  California: 0.0875,
  'New York': 0.08875,
  Texas: 0.0825,
  Florida: 0.07,
  Illinois: 0.1025,
  Washington: 0.1025,
  Massachusetts: 0.0625,
  Georgia: 0.0735,
  Colorado: 0.0781,
  Arizona: 0.086,
  'New Jersey': 0.06625,
  Pennsylvania: 0.06,
  Michigan: 0.06,
  'North Carolina': 0.0698,
  Virginia: 0.053,
  Ohio: 0.0723,
  Oregon: 0,
  Montana: 0,
  'New Hampshire': 0,
  Delaware: 0,
  Alaska: 0,
}

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina',
  'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
  'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
]

const UAE_EMIRATES = [
  'Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah',
]

const PK_PROVINCES = [
  'Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory',
  'Gilgit-Baltistan', 'Azad Jammu and Kashmir',
]

export const REGIONS: Record<RegionCode, RegionConfig> = {
  // ------------------------------------------------------------- USA
  us: {
    code: 'us',
    storeName: 'Orbis Store US',
    country: 'United States',
    countryCode: 'US',
    flag: '🇺🇸',
    locale: 'en-US',
    currency: { code: 'USD', symbol: '$', decimals: 2 },
    taxLabel: 'Sales tax',
    taxRate: 0.0725,
    taxRateBySubRegion: US_STATE_TAX,
    // US prices are quoted pre-tax; the rate depends on the ship-to state.
    taxIncludedInPrice: false,
    taxNote: 'Sales tax calculated at checkout',
    shipping: [
      { id: 'us-standard', label: 'Standard', eta: '4–7 business days', etaDays: [4, 7], amount: 895, freeOver: 15000 },
      { id: 'us-express', label: 'Express', eta: '2 business days', etaDays: [2, 2], amount: 1895 },
      { id: 'us-overnight', label: 'Overnight', eta: 'Next business day', etaDays: [1, 1], amount: 3495 },
    ],
    paymentMethods: [
      { id: 'card', label: 'Credit or debit card', description: 'Visa, Mastercard, Amex, Discover' },
      { id: 'paypal', label: 'PayPal', description: 'Pay with your PayPal balance or a linked account' },
      { id: 'applepay', label: 'Apple Pay', description: 'One-tap checkout on Apple devices' },
      { id: 'affirm', label: 'Affirm', description: 'Pay over 4 interest-free installments' },
    ],
    address: {
      regionLabel: 'State',
      regionOptions: US_STATES,
      postalLabel: 'ZIP code',
      postalPattern: /^\d{5}(-\d{4})?$/,
      postalPlaceholder: '94107',
      phonePrefix: '+1',
      phonePattern: /^\d{10}$/,
      phonePlaceholder: '415 555 0132',
    },
    support: { email: 'help@orbisstore.com', phone: '+1 (888) 555-0142', hours: 'Mon–Fri, 9am–6pm ET' },
    entity: {
      name: 'Orbis Store Inc.',
      addressLines: ['1200 Harrison Street, Suite 400', 'San Francisco, CA 94103', 'United States'],
      registration: 'EIN 88-3910442',
    },
    policy: {
      returnsDays: 30,
      dutiesNote: 'Ships from our Nevada warehouse. No customs charges on domestic orders.',
    },
    hero: { eyebrow: 'Shipping across all 50 states', promo: 'Free standard shipping over $150' },
    theme: {
      // Federal navy — restrained, reads as institutional rather than
      // patriotic-kitsch. 11.27:1 on white.
      accent: '27 58 107',
      accentHex: '#1B3A6B',
      motif: 'stripes',
      greeting: 'Shipped from the States, coast to coast.',
    },
  },

  // ------------------------------------------------------------- UAE
  ae: {
    code: 'ae',
    storeName: 'Orbis Store UAE',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    flag: '🇦🇪',
    locale: 'en-AE',
    currency: { code: 'AED', symbol: 'AED', decimals: 2 },
    taxLabel: 'VAT',
    taxRate: 0.05,
    // UAE consumer prices are advertised VAT-inclusive.
    taxIncludedInPrice: true,
    taxNote: 'Inclusive of 5% VAT',
    shipping: [
      { id: 'ae-standard', label: 'Standard', eta: '2–4 business days', etaDays: [2, 4], amount: 2500, freeOver: 40000 },
      { id: 'ae-nextday', label: 'Next day', eta: 'Next business day', etaDays: [1, 1], amount: 4500 },
      { id: 'ae-sameday', label: 'Same day (Dubai and Sharjah)', eta: 'Today, if ordered before 1pm', etaDays: [0, 0], amount: 7500 },
    ],
    paymentMethods: [
      { id: 'card', label: 'Credit or debit card', description: 'Visa, Mastercard, Amex' },
      { id: 'applepay', label: 'Apple Pay', description: 'One-tap checkout on Apple devices' },
      { id: 'tabby', label: 'Tabby', description: 'Split into 4 payments, 0% interest' },
      { id: 'tamara', label: 'Tamara', description: 'Pay in 3 — no fees, no interest' },
      { id: 'cod', label: 'Cash on delivery', description: 'Pay the courier in cash', surcharge: 1500, offline: true },
    ],
    address: {
      regionLabel: 'Emirate',
      regionOptions: UAE_EMIRATES,
      postalLabel: 'PO Box (optional)',
      postalPattern: null,
      postalPlaceholder: '00000',
      phonePrefix: '+971',
      phonePattern: /^5\d{8}$/,
      phonePlaceholder: '50 123 4567',
    },
    support: { email: 'help@orbisstore.ae', phone: '+971 4 555 0142', hours: 'Sun–Thu, 9am–6pm GST' },
    entity: {
      name: 'Orbis Store Trading L.L.C.',
      addressLines: ['Office 1408, Boulevard Plaza Tower 1', 'Downtown Dubai, Dubai', 'United Arab Emirates'],
      registration: 'TRN 100447281900003 · Licence 918442',
    },
    policy: {
      returnsDays: 14,
      dutiesNote: 'Ships from our Jebel Ali warehouse. Duties and VAT are already settled — nothing to pay on delivery.',
    },
    hero: { eyebrow: 'Delivering to all 7 emirates', promo: 'Free delivery over AED 400 · Tabby available' },
    theme: {
      // Desert gold. Gulf retail leans gold and sand rather than the
      // flag's red and green, which belong on the flag. 5.05:1 on white.
      accent: '138 106 31',
      accentHex: '#8A6A1F',
      motif: 'geometric',
      greeting: 'Ahlan wa sahlan — delivered across the Emirates.',
    },
  },

  // -------------------------------------------------------- PAKISTAN
  pk: {
    code: 'pk',
    storeName: 'Orbis Store Pakistan',
    country: 'Pakistan',
    countryCode: 'PK',
    flag: '🇵🇰',
    locale: 'en-PK',
    // PKR is quoted in whole rupees — decimals: 0 keeps the money maths
    // in integers without pretending paisa exist at retail.
    currency: { code: 'PKR', symbol: 'Rs', decimals: 0 },
    taxLabel: 'GST',
    taxRate: 0.18,
    taxIncludedInPrice: true,
    taxNote: 'Inclusive of 18% GST',
    shipping: [
      { id: 'pk-standard', label: 'Standard courier', eta: '3–5 business days', etaDays: [3, 5], amount: 350, freeOver: 25000 },
      { id: 'pk-express', label: 'Express courier', eta: '1–2 business days', etaDays: [1, 2], amount: 750 },
    ],
    paymentMethods: [
      { id: 'cod', label: 'Cash on delivery', description: 'Pay the rider when your order arrives', surcharge: 150, offline: true },
      { id: 'easypaisa', label: 'Easypaisa', description: 'Pay from your Easypaisa mobile account' },
      { id: 'jazzcash', label: 'JazzCash', description: 'Pay from your JazzCash mobile wallet' },
      { id: 'card', label: 'Credit or debit card', description: 'Visa, Mastercard, UnionPay' },
      { id: 'bank', label: 'Bank transfer', description: 'IBAN details emailed after you order', offline: true },
    ],
    address: {
      regionLabel: 'Province',
      regionOptions: PK_PROVINCES,
      postalLabel: 'Postal code',
      postalPattern: /^\d{5}$/,
      postalPlaceholder: '54000',
      phonePrefix: '+92',
      phonePattern: /^3\d{9}$/,
      phonePlaceholder: '300 1234567',
    },
    support: { email: 'help@orbisstore.pk', phone: '+92 42 111 0142', hours: 'Mon–Sat, 10am–7pm PKT' },
    entity: {
      name: 'Orbis Store (Pvt.) Ltd.',
      addressLines: ['Office 5, Arfa Software Technology Park', 'Ferozepur Road, Lahore 54600', 'Pakistan'],
      registration: 'NTN 7841029-3 · SECP 0182446',
    },
    policy: {
      returnsDays: 7,
      dutiesNote: 'Ships from our Lahore warehouse. Cash on delivery available nationwide.',
    },
    hero: { eyebrow: 'Nationwide delivery, cash on delivery welcome', promo: 'Free delivery over Rs 25,000' },
    theme: {
      // A lighter take on the flag green, so it still reads as text on
      // white at 6.61:1 where the flag's own #01411C goes almost black.
      accent: '19 107 51',
      accentHex: '#136B33',
      motif: 'bloom',
      greeting: 'Khush aamdeed — delivered nationwide, pay on delivery.',
    },
  },
}

export function getRegion(code: RegionCode): RegionConfig {
  return REGIONS[code]
}

/**
 * Effective tax rate for a ship-to sub-region. Only the US varies by
 * state today, but the signature lets any market opt in later.
 */
export function taxRateFor(config: RegionConfig, subRegion?: string): number {
  if (subRegion && config.taxRateBySubRegion && subRegion in config.taxRateBySubRegion) {
    return config.taxRateBySubRegion[subRegion]
  }
  return config.taxRate
}

export const REGION_LIST: RegionConfig[] = REGION_CODES.map((c) => REGIONS[c])
