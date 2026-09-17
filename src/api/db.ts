import type { Category, PriceByRegion, Product, Promo, StockByRegion, Variant } from '../types.js'

// ---------------------------------------------------------------------
// The seed catalogue for Orbis Store.
//
// Orbis is the little astronaut in the films — the character the whole
// range is built around. Figures of him are the flagship; the homeware,
// lighting, apparel and prints are the world he lives in.
//
// This file seeds the database on the API's first boot and is also the
// standalone catalogue when the storefront runs without a backend. After
// that first boot the database is the source of truth, so editing here
// will not silently rewrite live stock or prices.
//
// Prices are per-region minor units, NOT converted at runtime. Real
// stores price each market deliberately — landed cost, local
// competition, round local numbers — rather than running a live FX rate
// over a USD list price. Every variant therefore carries three prices.
// ---------------------------------------------------------------------

/** us cents, ae fils, pk whole rupees */
const p = (us: number, ae: number, pk: number): PriceByRegion => ({ us, ae, pk })
const s = (us: number, ae: number, pk: number): StockByRegion => ({ us, ae, pk })

const CDN = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P'

export const VIDEOS = {
  hero: `${CDN}/hf_20260331_045634_e1c98c76-1265-4f5c-882a-4276f2080894.mp4`,
  atelier: `${CDN}/hf_20260331_151551_992053d1-3d3e-4b8c-abac-45f22158f411.mp4`,
  figure1: `${CDN}/hf_20260331_053923_22c0a6a5-313c-474c-85ff-3b50d25e944a.mp4`,
  figure2: `${CDN}/hf_20260331_054411_511c1b7a-fb2f-42ef-bf6c-32c0b1a06e79.mp4`,
  figure3: `${CDN}/hf_20260331_055427_ac7035b5-9f3b-4289-86fc-941b2432317d.mp4`,
  cta: `${CDN}/hf_20260331_055729_72d66327-b59e-4ae9-bb70-de6ccb5ecdb0.mp4`,
} as const

/** One looping clip per department, for the 3D category carousel. */
export const CATEGORY_VIDEOS = {
  figures: `${CDN}/hf_20260506_030111_a9e15665-d379-4a7f-8116-695bbe452ad1.mp4`,
  lighting: `${CDN}/hf_20260429_171347_f640c30d-ec21-426a-98bc-77e07c2c60cb.mp4`,
  apparel: `${CDN}/hf_20260503_104800_bc43ae09-f494-43e3-97d7-2f8c1692cfd7.mp4`,
  prints: `${CDN}/hf_20260423_161253_c72b1869-400f-45ed-ac0c-52f68c2ed5bd.mp4`,
  homeware: `${CDN}/hf_20260418_115655_b4d9cd77-feed-43cd-a198-af78ebdf1f7a.mp4`,
} as const

export type CategoryCard = {
  id: Category
  label: string
  blurb: string
  video: string
  /** Short line printed on the card back, under the department name. */
  strapline: string
}

export const CATEGORIES: CategoryCard[] = [
  {
    id: 'figures',
    label: 'Figures',
    blurb: 'Orbis himself, hand-painted and numbered. Three sizes, and a brass one for your keys.',
    video: CATEGORY_VIDEOS.figures,
    strapline: 'Numbered editions',
  },
  {
    id: 'homeware',
    label: 'Homeware',
    blurb: 'Steel, stoneware and machined aluminium for the desk and the shelf.',
    video: CATEGORY_VIDEOS.homeware,
    strapline: 'Built to outlast you',
  },
  {
    id: 'lighting',
    label: 'Lighting',
    blurb: 'Warm, dimmable and quiet about it. Cordless or hard-wired.',
    video: CATEGORY_VIDEOS.lighting,
    strapline: 'Dim to warm',
  },
  {
    id: 'apparel',
    label: 'Apparel',
    blurb: 'Heavyweight cotton, printed in small runs and made in Portugal.',
    video: CATEGORY_VIDEOS.apparel,
    strapline: 'Made in Portugal',
  },
  {
    id: 'prints',
    label: 'Prints',
    blurb: 'Archival giclée on 310gsm cotton rag, rated a hundred years.',
    video: CATEGORY_VIDEOS.prints,
    strapline: '100-year ink',
  },
]

type Combo = {
  suffix: string
  label: string
  size?: string
  color?: string
  colorHex?: string
  /** Added to the base price, in each region's minor units. */
  delta?: PriceByRegion
  stock: StockByRegion
}

function buildVariants(sku: string, base: PriceByRegion, combos: Combo[]): Variant[] {
  return combos.map((c) => ({
    id: `${sku}-${c.suffix}`.toLowerCase(),
    sku: `${sku}-${c.suffix}`,
    label: c.label,
    options: { size: c.size, color: c.color, colorHex: c.colorHex },
    price: c.delta
      ? { us: base.us + c.delta.us, ae: base.ae + c.delta.ae, pk: base.pk + c.delta.pk }
      : base,
    stock: c.stock,
  }))
}

const ONE = (stock: StockByRegion): Combo[] => [{ suffix: 'STD', label: 'Standard', stock }]

export const PRODUCTS: Product[] = [
  // ------------------------------------------------------- figures
  {
    id: 'orbis-classic',
    slug: 'orbis-classic-figure',
    name: 'Orbis Classic Figure',
    tagline: 'Hand-painted resin, 180mm tall',
    description:
      'The original Orbis, and the one most people start a shelf with. Solid resin, hand-painted in six passes, with a tinted clear coat on the visor that catches whatever light is in the room. Signed and numbered underneath, and packed in a foam-lined box that survives being posted.',
    highlights: [
      'Hand-painted — no two are identical',
      'Signed and numbered on the base',
      'Weighted so it will not tip off a shelf',
      'Gift-ready foam-lined box',
    ],
    rating: { average: 4.8, count: 214 },
    category: 'figures',
    badges: ['Edition of 500', 'Signed and numbered'],
    media: [{ kind: 'video', src: VIDEOS.figure1 }, { kind: 'render', shape: 'orb', hue: 214 }],
    specs: [
      { label: 'Height', value: '180 mm' },
      { label: 'Material', value: 'Hand-painted resin, weighted base' },
      { label: 'Weight', value: '640 g' },
      { label: 'In the box', value: 'Figure, certificate, foam-lined box' },
      { label: 'Care', value: 'Dry microfibre; keep out of direct sun' },
    ],
    variants: buildVariants('ORB-CL', p(28900, 106000, 79900), ONE(s(12, 6, 4))),
    featured: 100,
    weightGrams: 640,
  },
  {
    id: 'orbis-explorer',
    slug: 'orbis-explorer-figure',
    name: 'Orbis Explorer Figure',
    tagline: 'Flocked helmet, 200mm tall',
    description:
      'Our best seller. The same resin body as the Classic, but the helmet is flocked by hand in short-pile fibre — it looks soft from across a room and there is no mistaking it up close. Stands slightly taller, so the two display well as a pair.',
    highlights: [
      'Hand-flocked helmet you can feel',
      'Pairs with the Classic — 20mm taller',
      'Signed and numbered on the base',
      'Gift-ready foam-lined box',
    ],
    rating: { average: 4.9, count: 386 },
    category: 'figures',
    badges: ['Edition of 500', 'Best seller'],
    media: [{ kind: 'video', src: VIDEOS.figure2 }, { kind: 'render', shape: 'ring', hue: 268 }],
    specs: [
      { label: 'Height', value: '200 mm' },
      { label: 'Material', value: 'Hand-painted resin, flocked helmet' },
      { label: 'Weight', value: '710 g' },
      { label: 'In the box', value: 'Figure, certificate, foam-lined box' },
      { label: 'Care', value: 'Soft brush only — do not wet the flocking' },
    ],
    variants: buildVariants('ORB-EX', p(34900, 128000, 96900), ONE(s(8, 5, 3))),
    featured: 98,
    weightGrams: 710,
  },
  {
    id: 'orbis-mini',
    slug: 'orbis-mini-figure',
    name: 'Orbis Mini Figure',
    tagline: 'Desk size, 120mm tall',
    description:
      'The easiest one to buy — for a desk, a shelf edge, or someone you are not sure about yet. Same hand-painted finish and numbered base as the full-size figures, at two thirds the height, in a window box you do not need to wrap.',
    highlights: [
      'Fits any desk — 120mm tall',
      'Same hand-painted finish as the big ones',
      'Window box, no wrapping needed',
      'Our most-gifted item',
    ],
    rating: { average: 4.7, count: 512 },
    category: 'figures',
    badges: ['Edition of 1,000', 'Window box'],
    media: [{ kind: 'video', src: VIDEOS.figure3 }, { kind: 'render', shape: 'prism', hue: 158 }],
    specs: [
      { label: 'Height', value: '120 mm' },
      { label: 'Material', value: 'Hand-painted resin' },
      { label: 'Weight', value: '310 g' },
      { label: 'In the box', value: 'Figure in a window box' },
      { label: 'Care', value: 'Dry microfibre; keep out of direct sun' },
    ],
    variants: buildVariants('ORB-MN', p(22900, 84000, 63900), ONE(s(21, 11, 9))),
    featured: 92,
    weightGrams: 310,
  },
  {
    id: 'orbis-keyring',
    slug: 'orbis-brass-keyring',
    name: 'Orbis Brass Keyring',
    tagline: 'Solid brass, 52mm — ages honestly',
    description:
      'Orbis turned from solid brass and left unlacquered, so he darkens where you hold him and stays bright where you do not. The split ring is stainless — the one part you never want to be soft. The cheapest way in, and the one that actually goes everywhere with you.',
    highlights: [
      'Solid brass — develops a patina with use',
      'Stainless split ring that will not deform',
      'Fits in a pocket at 46g',
      'Under $30 — the easy add-on',
    ],
    rating: { average: 4.6, count: 640 },
    category: 'figures',
    badges: ['Everyday carry'],
    media: [{ kind: 'render', shape: 'monolith', hue: 45 }],
    specs: [
      { label: 'Dimensions', value: '52 × 22 × 8 mm' },
      { label: 'Material', value: 'Unlacquered brass, stainless ring' },
      { label: 'Weight', value: '46 g' },
      { label: 'Care', value: 'Polish with a cloth, or let it patina' },
    ],
    variants: buildVariants('ORB-KR', p(2800, 10500, 3200), ONE(s(80, 40, 55))),
    featured: 58,
    weightGrams: 46,
  },

  // ------------------------------------------------------ homeware
  {
    id: 'monolith-bookends',
    slug: 'monolith-bookends',
    name: 'Monolith Bookends',
    tagline: 'Solid steel pair, 3.2kg each',
    description:
      'Two blocks of cold-rolled steel heavy enough to hold a shelf of hardbacks without sliding. Milled flat on five faces, left raw on the sixth so it patinas with the room, and felted underneath so they will not mark the wood.',
    highlights: [
      '6.4kg the pair — they genuinely do not slide',
      'Felt-backed to protect shelving',
      'Sold as a pair, not singly',
      'Raw or blackened finish',
    ],
    rating: { average: 4.8, count: 96 },
    category: 'homeware',
    badges: ['Sold as a pair'],
    media: [{ kind: 'render', shape: 'monolith', hue: 28 }],
    specs: [
      { label: 'Dimensions', value: '80 × 60 × 180 mm each' },
      { label: 'Material', value: 'Cold-rolled steel, oiled' },
      { label: 'Weight', value: '6.4 kg the pair' },
      { label: 'Underside', value: 'Felt, to protect shelving' },
      { label: 'Care', value: 'Re-oil twice a year' },
    ],
    variants: buildVariants('MON-BK', p(12900, 47500, 35900), [
      { suffix: 'RAW', label: 'Raw steel', color: 'Raw steel', colorHex: '#8f9299', stock: s(30, 14, 10) },
      { suffix: 'BLK', label: 'Blackened', color: 'Blackened', colorHex: '#26282f', delta: p(2000, 7500, 5000), stock: s(18, 9, 6) },
    ]),
    featured: 70,
    weightGrams: 6400,
  },
  {
    id: 'drift-vessel',
    slug: 'drift-vessel',
    name: 'Drift Vessel',
    tagline: 'Wheel-thrown stoneware, matte glaze',
    description:
      'Thrown by hand and fired in a reduction kiln that never gives the same result twice, so expect small variations in tone and speckle — that is the point. Fully watertight, so it takes cut stems as happily as it takes nothing at all.',
    highlights: [
      'Watertight — safe for fresh flowers',
      'Every piece glazes differently',
      'Wheel-thrown, not slip-cast',
      'Two colourways',
    ],
    rating: { average: 4.7, count: 71 },
    category: 'homeware',
    media: [{ kind: 'render', shape: 'wave', hue: 200 }],
    specs: [
      { label: 'Dimensions', value: '140 × 140 × 260 mm' },
      { label: 'Material', value: 'Stoneware, matte reduction glaze' },
      { label: 'Weight', value: '1.6 kg' },
      { label: 'Watertight', value: 'Yes — suitable for cut flowers' },
      { label: 'Care', value: 'Hand wash; not dishwasher safe' },
    ],
    variants: buildVariants('DRF-VS', p(14500, 53000, 39900), [
      { suffix: 'ASH', label: 'Ash grey', color: 'Ash grey', colorHex: '#b6b9bd', stock: s(16, 8, 7) },
      { suffix: 'INK', label: 'Ink blue', color: 'Ink blue', colorHex: '#1e2b48', stock: s(11, 6, 5) },
    ]),
    featured: 60,
    weightGrams: 1600,
  },
  {
    id: 'parallax-clock',
    slug: 'parallax-desk-clock',
    name: 'Parallax Desk Clock',
    tagline: 'Silent sweep, machined aluminium',
    description:
      'No tick. A silent sweep movement inside a single billet of machined aluminium, with hands you can read across a room. One AA cell runs it for about two years, and it is quiet enough for a bedroom.',
    highlights: [
      'Completely silent — safe for a bedroom',
      'About two years on one AA cell',
      'Machined from one billet of aluminium',
      'Battery included',
    ],
    rating: { average: 4.9, count: 143 },
    category: 'homeware',
    badges: ['Silent movement'],
    media: [{ kind: 'render', shape: 'ring', hue: 12, accent: 200 }],
    specs: [
      { label: 'Dimensions', value: '120 × 120 × 45 mm' },
      { label: 'Movement', value: 'Silent continuous sweep' },
      { label: 'Power', value: '1 × AA, about 24 months' },
      { label: 'Weight', value: '640 g' },
      { label: 'In the box', value: 'Clock, one AA cell' },
    ],
    variants: buildVariants('PAR-CL', p(17500, 64000, 48900), [
      { suffix: 'SIL', label: 'Natural aluminium', color: 'Natural', colorHex: '#c3c7cd', stock: s(19, 10, 7) },
      { suffix: 'BLK', label: 'Anodised black', color: 'Anodised black', colorHex: '#1c1e24', stock: s(15, 8, 6) },
    ]),
    featured: 62,
    weightGrams: 640,
  },

  // ------------------------------------------------------ lighting
  {
    id: 'meridian-light',
    slug: 'meridian-table-light',
    name: 'Meridian Table Light',
    tagline: 'Cordless, dimmable, 9-hour charge',
    description:
      'A cordless table light you can carry from desk to dinner table to balcony. The LED sits deep enough that you never see the source, only the pool it throws. Touch the top to cycle four levels — nine hours at the lowest, three at the brightest — and charge it over USB-C.',
    highlights: [
      'Cordless — 9 hours on a charge',
      'Charges over USB-C in about 3 hours',
      'Four brightness levels, touch to cycle',
      'Warm 2700K light, no visible glare',
    ],
    rating: { average: 4.8, count: 268 },
    category: 'lighting',
    badges: ['Cordless', 'USB-C'],
    media: [{ kind: 'render', shape: 'orb', hue: 42, accent: 190 }],
    specs: [
      { label: 'Dimensions', value: '95 × 95 × 240 mm' },
      { label: 'Output', value: '2700K, 180 lumens max' },
      { label: 'Battery', value: '5200 mAh — 9 h at level 1' },
      { label: 'Charging', value: 'USB-C, about 3 hours' },
      { label: 'In the box', value: 'Light, 1.5 m USB-C cable' },
    ],
    variants: buildVariants('MER-TL', p(18900, 69500, 52900), [
      { suffix: 'BRS', label: 'Brushed brass', color: 'Brushed brass', colorHex: '#b08d57', stock: s(24, 12, 8) },
      { suffix: 'GRA', label: 'Graphite', color: 'Graphite', colorHex: '#3a3d44', stock: s(31, 15, 12) },
      { suffix: 'CRM', label: 'Chalk', color: 'Chalk', colorHex: '#e8e4dc', stock: s(0, 4, 6) },
    ]),
    featured: 95,
    weightGrams: 1100,
  },
  {
    id: 'halo-pendant',
    slug: 'halo-pendant',
    name: 'Halo Pendant',
    tagline: 'Ceiling ring, 400mm, dim-to-warm',
    description:
      'An unbroken aluminium ring lit from its inner edge, so the light falls inward and the fitting itself stays dark. It dims from 3000K down to 1800K on the way to off, the way a filament does. Drop height is set at installation.',
    highlights: [
      'Dims warm, like a real filament',
      'Adjustable drop, 150–1800mm',
      'Hard-wired — needs a dimmer switch',
      '1400 lumens at full',
    ],
    rating: { average: 4.7, count: 88 },
    category: 'lighting',
    badges: ['Dim-to-warm'],
    media: [{ kind: 'render', shape: 'ring', hue: 265, accent: 320 }],
    specs: [
      { label: 'Diameter', value: '400 mm' },
      { label: 'Output', value: '3000K–1800K, 1400 lumens max' },
      { label: 'Drop', value: '150–1800 mm, adjustable' },
      { label: 'Fitting', value: 'Hard-wired — dimmer switch required' },
      { label: 'Weight', value: '2.8 kg' },
    ],
    variants: buildVariants('HAL-PD', p(25900, 95000, 71900), [
      { suffix: 'BLK', label: 'Matte black', color: 'Matte black', colorHex: '#1c1e24', stock: s(14, 9, 5) },
      { suffix: 'ALU', label: 'Raw aluminium', color: 'Raw aluminium', colorHex: '#a9adb4', stock: s(9, 6, 3) },
    ]),
    featured: 80,
    weightGrams: 2800,
  },

  // ------------------------------------------------------- apparel
  {
    id: 'signal-hoodie',
    slug: 'signal-hoodie',
    name: 'Signal Hoodie',
    tagline: '480gsm loopback cotton, boxy fit',
    description:
      'A properly heavy hoodie — 480gsm loopback cotton, garment-dyed so it fades the way you want rather than the way it happens. Boxy through the body with a double-layer hood and a small Orbis at the chest. Cut to wear over a tee; size down if you like a regular fit.',
    highlights: [
      '480gsm — heavier than almost anything on the high street',
      'Garment-dyed, so it fades evenly',
      'Double-layer hood that holds its shape',
      'Made in Portugal',
    ],
    rating: { average: 4.8, count: 431 },
    category: 'apparel',
    badges: ['480gsm', 'Garment-dyed'],
    media: [{ kind: 'render', shape: 'grid', hue: 222 }],
    specs: [
      { label: 'Fabric', value: '480gsm loopback cotton, garment-dyed' },
      { label: 'Fit', value: 'Boxy — size down for a regular fit' },
      { label: 'Made in', value: 'Portugal' },
      { label: 'Model', value: '183 cm, wearing M' },
      { label: 'Care', value: 'Cold wash, dry flat' },
    ],
    variants: buildVariants('SIG-HD', p(9800, 36000, 12900), [
      { suffix: 'BLK-S', label: 'Black / S', size: 'S', color: 'Black', colorHex: '#16181d', stock: s(14, 8, 22) },
      { suffix: 'BLK-M', label: 'Black / M', size: 'M', color: 'Black', colorHex: '#16181d', stock: s(26, 12, 34) },
      { suffix: 'BLK-L', label: 'Black / L', size: 'L', color: 'Black', colorHex: '#16181d', stock: s(22, 11, 29) },
      { suffix: 'BLK-XL', label: 'Black / XL', size: 'XL', color: 'Black', colorHex: '#16181d', stock: s(9, 5, 17) },
      { suffix: 'BON-S', label: 'Bone / S', size: 'S', color: 'Bone', colorHex: '#ddd8cc', stock: s(7, 4, 12) },
      { suffix: 'BON-M', label: 'Bone / M', size: 'M', color: 'Bone', colorHex: '#ddd8cc', stock: s(18, 9, 21) },
      { suffix: 'BON-L', label: 'Bone / L', size: 'L', color: 'Bone', colorHex: '#ddd8cc', stock: s(15, 7, 19) },
      { suffix: 'BON-XL', label: 'Bone / XL', size: 'XL', color: 'Bone', colorHex: '#ddd8cc', stock: s(0, 2, 8) },
    ]),
    featured: 88,
    weightGrams: 820,
  },
  {
    id: 'deep-field-tee',
    slug: 'deep-field-tee',
    name: 'Deep Field Tee',
    tagline: '240gsm combed cotton, discharge print',
    description:
      'The Orbis graphic is discharged into the fabric rather than screened on top, so it feels like part of the shirt from the first wear — and it will not crack at the shoulders in two years. Pre-shrunk, so the size you buy is the size it stays.',
    highlights: [
      'Print will not crack or peel',
      'Pre-shrunk — no surprise after washing',
      '240gsm combed cotton, regular fit',
      'Made in Portugal',
    ],
    rating: { average: 4.7, count: 604 },
    category: 'apparel',
    badges: ['Discharge print'],
    media: [{ kind: 'render', shape: 'wave', hue: 184 }],
    specs: [
      { label: 'Fabric', value: '240gsm combed ringspun cotton' },
      { label: 'Fit', value: 'Regular, pre-shrunk' },
      { label: 'Made in', value: 'Portugal' },
      { label: 'Model', value: '183 cm, wearing M' },
      { label: 'Care', value: 'Cold wash, inside out' },
    ],
    variants: buildVariants('DPF-TE', p(4200, 15500, 4900), [
      { suffix: 'BLK-S', label: 'Black / S', size: 'S', color: 'Black', colorHex: '#16181d', stock: s(32, 16, 48) },
      { suffix: 'BLK-M', label: 'Black / M', size: 'M', color: 'Black', colorHex: '#16181d', stock: s(41, 22, 63) },
      { suffix: 'BLK-L', label: 'Black / L', size: 'L', color: 'Black', colorHex: '#16181d', stock: s(38, 19, 55) },
      { suffix: 'BLK-XL', label: 'Black / XL', size: 'XL', color: 'Black', colorHex: '#16181d', stock: s(17, 10, 31) },
      { suffix: 'SLT-S', label: 'Slate / S', size: 'S', color: 'Slate', colorHex: '#4a5160', stock: s(12, 7, 20) },
      { suffix: 'SLT-M', label: 'Slate / M', size: 'M', color: 'Slate', colorHex: '#4a5160', stock: s(24, 13, 36) },
      { suffix: 'SLT-L', label: 'Slate / L', size: 'L', color: 'Slate', colorHex: '#4a5160', stock: s(20, 12, 33) },
      { suffix: 'SLT-XL', label: 'Slate / XL', size: 'XL', color: 'Slate', colorHex: '#4a5160', stock: s(6, 4, 14) },
    ]),
    featured: 75,
    weightGrams: 220,
  },
  {
    id: 'vector-cap',
    slug: 'vector-cap',
    name: 'Vector Cap',
    tagline: 'Unstructured six-panel, brass closure',
    description:
      'An unstructured crown in washed cotton twill, so it packs flat in a bag and takes the shape of your head after about a week. Brass slider closure rather than plastic, and a small embroidered Orbis at the front.',
    highlights: [
      'Packs flat — no crushed crown',
      'Brass slider, not a plastic snap',
      'One size, adjustable',
      'Embroidered, not printed',
    ],
    rating: { average: 4.5, count: 189 },
    category: 'apparel',
    media: [{ kind: 'render', shape: 'prism', hue: 96 }],
    specs: [
      { label: 'Fabric', value: 'Washed cotton twill' },
      { label: 'Fit', value: 'One size — brass slider closure' },
      { label: 'Made in', value: 'Portugal' },
      { label: 'Care', value: 'Spot clean' },
    ],
    variants: buildVariants('VEC-CP', p(3800, 14000, 4200), [
      { suffix: 'BLK', label: 'Black', color: 'Black', colorHex: '#16181d', stock: s(44, 21, 38) },
      { suffix: 'OLV', label: 'Olive', color: 'Olive', colorHex: '#4b5340', stock: s(29, 15, 26) },
    ]),
    featured: 50,
    weightGrams: 140,
  },

  // -------------------------------------------------------- prints
  {
    id: 'orbis-portrait-print',
    slug: 'orbis-portrait-print',
    name: 'Orbis Portrait',
    tagline: 'Archival giclée on 310gsm cotton rag',
    description:
      'A twelve-hour render of Orbis on Hahnemühle 310gsm cotton rag, printed with pigment inks rated a hundred years without visible fade under glass. A 30mm border means it drops straight into a standard frame. Ships rolled in a rigid tube.',
    highlights: [
      'Fits standard A3, A2 and A1 frames',
      '100-year archival pigment inks',
      '30mm border, ready to frame',
      'Ships in a rigid tube, never folded',
    ],
    rating: { average: 4.8, count: 157 },
    category: 'prints',
    badges: ['Archival', 'Unframed'],
    media: [{ kind: 'render', shape: 'orb', hue: 300, accent: 28 }],
    specs: [
      { label: 'Paper', value: 'Hahnemühle 310gsm cotton rag' },
      { label: 'Ink', value: 'Pigment, 100-year rating' },
      { label: 'Border', value: '30 mm on all sides' },
      { label: 'Framing', value: 'Not included — fits standard frames' },
      { label: 'Ships', value: 'Rolled in a rigid tube' },
    ],
    variants: buildVariants('ORB-PR', p(6500, 24000, 8900), [
      { suffix: 'A3', label: 'A3 — 297 × 420 mm', size: 'A3', stock: s(60, 30, 40) },
      { suffix: 'A2', label: 'A2 — 420 × 594 mm', size: 'A2', delta: p(3000, 11000, 4000), stock: s(45, 22, 30) },
      { suffix: 'A1', label: 'A1 — 594 × 841 mm', size: 'A1', delta: p(8000, 29500, 11000), stock: s(20, 10, 12) },
    ]),
    featured: 65,
    weightGrams: 400,
  },
  {
    id: 'star-chart-set',
    slug: 'star-chart-print-set',
    name: 'Star Chart Set',
    tagline: 'Three prints, numbered as one edition',
    description:
      'Three plates from the same survey, numbered together so the set stays together. Same paper and inks as the Orbis Portrait. They hang well as a row or as a block of three, and work out cheaper than buying three prints singly.',
    highlights: [
      'Three prints, one numbered edition',
      'Cheaper than three prints bought singly',
      'Hangs as a row or a 3-up block',
      'Ships in one rigid tube',
    ],
    rating: { average: 4.9, count: 62 },
    category: 'prints',
    badges: ['Set of 3', 'Numbered'],
    media: [{ kind: 'render', shape: 'grid', hue: 252, accent: 42 }],
    specs: [
      { label: 'Paper', value: 'Hahnemühle 310gsm cotton rag' },
      { label: 'Size', value: '3 × A3, 297 × 420 mm' },
      { label: 'Edition', value: 'Numbered, 200 sets' },
      { label: 'Framing', value: 'Not included' },
      { label: 'Ships', value: 'Rolled in one rigid tube' },
    ],
    variants: buildVariants('STC-ST', p(12000, 44000, 16900), ONE(s(28, 14, 18))),
    featured: 55,
    weightGrams: 700,
  },
  // ------------------------------------- imported, Pakistan only
  //
  // Brought in from the Guangzhou partner rather than held in Lahore, so
  // they carry origin 'import' and quote the import delivery table — see
  // importShipping in regions/config.ts. Stocked at zero in the US and
  // UAE because the route only exists into Pakistan; the catalogue is
  // shared across stores and stock is what decides where a thing sells.
  {
    id: 'orbis-display-case',
    slug: 'orbis-display-case',
    name: 'Acrylic Display Case',
    tagline: 'Dust cover for a single figure, 220mm',
    description:
      'A five-sided cast acrylic cover on a weighted base, sized so a Classic or an Explorer clears the roof with room above the helmet. Keeps the dust off without hiding anything — the walls are 3mm and optically clear rather than the milky extruded sheet these usually come in.',
    highlights: [
      'Fits figures up to 210 mm tall',
      '3 mm cast acrylic, optically clear',
      'Weighted base — will not slide',
      'Felt underside, safe on a finished shelf',
    ],
    rating: { average: 4.6, count: 58 },
    category: 'homeware',
    badges: ['Imported'],
    media: [{ kind: 'render', shape: 'prism', hue: 200 }],
    specs: [
      { label: 'External size', value: '150 x 150 x 220 mm' },
      { label: 'Material', value: 'Cast acrylic, weighted MDF base' },
      { label: 'Weight', value: '900 g' },
      { label: 'Ships from', value: 'Guangzhou' },
    ],
    variants: buildVariants('ORB-CASE', p(4900, 18000, 13900), ONE(s(0, 0, 14))),
    featured: 62,
    weightGrams: 900,
    origin: 'import',
  },
  {
    id: 'orbis-light-panel',
    slug: 'orbis-shelf-light-panel',
    name: 'Shelf Light Panel',
    tagline: 'Rechargeable LED bar, warm and cool',
    description:
      'A slim aluminium bar that sticks or magnets under a shelf and lights whatever is standing on the one below. Two temperatures and a dimmer, charged over USB-C, and it runs about a fortnight on a charge at the level you would actually use.',
    highlights: [
      'Warm 2700K and cool 5000K',
      'Stepless dimming, remembers the last level',
      'USB-C, roughly two weeks per charge',
      'Magnetic mount plus adhesive strip',
    ],
    rating: { average: 4.4, count: 91 },
    category: 'lighting',
    badges: ['Imported'],
    media: [{ kind: 'render', shape: 'monolith', hue: 44 }],
    specs: [
      { label: 'Length', value: '300 mm' },
      { label: 'Colour temperature', value: '2700K / 5000K' },
      { label: 'Battery', value: '2000 mAh, USB-C' },
      { label: 'Ships from', value: 'Guangzhou' },
    ],
    variants: buildVariants('ORB-LED', p(3200, 11800, 8900), ONE(s(0, 0, 26))),
    featured: 58,
    weightGrams: 240,
    origin: 'import',
  },
  {
    id: 'orbis-riser-set',
    slug: 'orbis-acrylic-riser-set',
    name: 'Acrylic Riser Set',
    tagline: 'Three heights, for staging a shelf',
    description:
      'Three clear risers at 40, 70 and 100 mm so a row of figures reads as a group rather than a line. Edges are flame-polished, not sawn, which is the difference between a display piece and an offcut.',
    highlights: [
      'Three heights: 40, 70 and 100 mm',
      'Flame-polished edges',
      'Holds a 2 kg figure without flexing',
      'Stacks flat when not in use',
    ],
    rating: { average: 4.7, count: 43 },
    category: 'homeware',
    badges: ['Imported', 'Set of three'],
    media: [{ kind: 'render', shape: 'grid', hue: 286 }],
    specs: [
      { label: 'Heights', value: '40 / 70 / 100 mm' },
      { label: 'Top plate', value: '120 x 120 mm' },
      { label: 'Material', value: '5 mm cast acrylic' },
      { label: 'Ships from', value: 'Guangzhou' },
    ],
    variants: buildVariants('ORB-RISE', p(3900, 14500, 10900), ONE(s(0, 0, 19))),
    featured: 54,
    weightGrams: 680,
    origin: 'import',
  },
]

// --------------------------------------------------------------- promos

export const PROMOS: Promo[] = [
  {
    code: 'ORBIS10',
    label: '10% off your first order',
    percentOff: 10,
    minSubtotal: p(0, 0, 0),
    regions: ['us', 'ae', 'pk'],
  },
  {
    code: 'GULF15',
    label: '15% off across the UAE store',
    percentOff: 15,
    minSubtotal: p(0, 30000, 0),
    regions: ['ae'],
  },
  {
    code: 'PK20',
    label: '20% off orders over Rs 20,000',
    percentOff: 20,
    minSubtotal: p(0, 0, 20000),
    regions: ['pk'],
  },
  {
    code: 'FREIGHT',
    label: '5% off — continental US only',
    percentOff: 5,
    minSubtotal: p(10000, 0, 0),
    regions: ['us'],
  },
]

export function findProductBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((prod) => prod.slug === slug)
}

export function findProductById(id: string): Product | undefined {
  return PRODUCTS.find((prod) => prod.id === id)
}
