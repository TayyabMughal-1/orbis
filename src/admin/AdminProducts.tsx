import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { adminApi, type ProductPayload } from '../api/admin'
import { errorMessage } from '../api/client'
import { CATEGORIES } from '../api/db'
import { REGIONS, REGION_CODES, type RegionCode } from '../regions/config'
import { formatMoney, minorPerMajor } from '../lib/money'
import { AdminButton, AdminHeading, Banner, Field, inputClass } from './AdminShell'
import type { Product, Variant } from '../types'

// ---------------------------------------------------------------------
// Products.
//
// The one screen where a mistake costs money, so the money inputs get
// special care: prices are stored in minor units but typed in major
// ones, because nobody wants to enter 28900 for $289.00. The conversion
// happens here and only here.
// ---------------------------------------------------------------------

const majorToMinor = (value: string, region: RegionCode): number => {
  const unit = minorPerMajor(REGIONS[region])
  const parsed = Number(String(value).replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? Math.round(parsed * unit) : 0
}

const minorToMajor = (value: number, region: RegionCode): string => {
  const unit = minorPerMajor(REGIONS[region])
  const decimals = REGIONS[region].currency.decimals
  return (value / unit).toFixed(decimals)
}

// ------------------------------------------------------------ the list

export function AdminProductList() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    adminApi
      .listProducts()
      .then(setProducts)
      .catch((err) => setError(errorMessage(err)))
  }, [])

  useEffect(load, [load])

  async function remove(product: Product) {
    // Deleting takes its variants, prices and stock with it, so make the
    // consequence explicit rather than showing a generic "are you sure".
    const ok = window.confirm(
      `Delete "${product.name}"?\n\nThis removes its ${product.variants.length} variant(s) and all stock counts in every region. Orders already placed keep their own copy of the details. This cannot be undone.`,
    )
    if (!ok) return
    try {
      await adminApi.deleteProduct(product.id)
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <AdminHeading
        title="Products"
        subtitle={products ? `${products.length} products across ${REGION_CODES.length} stores` : undefined}
        action={
          <Link to="/admin/products/new">
            <AdminButton>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} /> New product
              </span>
            </AdminButton>
          </Link>
        }
      />

      {error && <Banner tone="error">{error}</Banner>}
      {!products && !error && <p className="font-mono text-[12px] text-cream/45">Loading…</p>}

      {products && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-left font-mono text-[10px] uppercase tracking-wide text-cream/40">
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4">Department</th>
                <th className="py-2 pr-4">Variants</th>
                {REGION_CODES.map((r) => (
                  <th key={r} className="py-2 pr-4">
                    {REGIONS[r].currency.code} · stock
                  </th>
                ))}
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const stockFor = (r: RegionCode) =>
                  product.variants.reduce((n, v) => n + v.stock[r], 0)
                const fromPrice = (r: RegionCode) =>
                  Math.min(...product.variants.map((v) => v.price[r]))

                return (
                  <tr key={product.id} className="border-b border-white/5 align-middle">
                    <td className="py-3 pr-4">
                      <Link
                        to={`/admin/products/${product.slug}`}
                        className="font-grotesk text-[13px] uppercase text-cream hover:text-neon"
                      >
                        {product.name}
                      </Link>
                      <div className="mt-0.5 font-mono text-[10px] text-cream/35">/{product.slug}</div>
                    </td>
                    <td className="py-3 pr-4 font-mono text-[11px] capitalize text-cream/60">
                      {product.category}
                    </td>
                    <td className="py-3 pr-4 font-mono text-[11px] text-cream/60">
                      {product.variants.length}
                    </td>
                    {REGION_CODES.map((r) => {
                      const stock = stockFor(r)
                      return (
                        <td key={r} className="py-3 pr-4 font-mono text-[11px]">
                          <span className="text-cream/70">
                            {formatMoney(fromPrice(r), REGIONS[r], true)}
                          </span>
                          <span className={stock === 0 ? 'text-amber-300' : 'text-cream/40'}>
                            {' '}· {stock}
                          </span>
                        </td>
                      )
                    })}
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        onClick={() => remove(product)}
                        aria-label={`Delete ${product.name}`}
                        className="text-cream/30 transition-colors hover:text-red-300"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------- the editor

type VariantDraft = {
  id?: string
  sku: string
  label: string
  size: string
  color: string
  colorHex: string
  price: Record<RegionCode, string>
  stock: Record<RegionCode, string>
}

const blankVariant = (): VariantDraft => ({
  sku: '',
  label: 'Standard',
  size: '',
  color: '',
  colorHex: '',
  price: { us: '0.00', ae: '0.00', pk: '0' },
  stock: { us: '0', ae: '0', pk: '0' },
})

function toDraft(variant: Variant): VariantDraft {
  return {
    id: variant.id,
    sku: variant.sku,
    label: variant.label,
    size: variant.options.size ?? '',
    color: variant.options.color ?? '',
    colorHex: variant.options.colorHex ?? '',
    price: {
      us: minorToMajor(variant.price.us, 'us'),
      ae: minorToMajor(variant.price.ae, 'ae'),
      pk: minorToMajor(variant.price.pk, 'pk'),
    },
    stock: {
      us: String(variant.stock.us),
      ae: String(variant.stock.ae),
      pk: String(variant.stock.pk),
    },
  }
}

export function AdminProductEditor() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const isNew = slug === 'new'

  const [form, setForm] = useState({
    id: '',
    slug: '',
    name: '',
    tagline: '',
    description: '',
    highlights: '',
    category: CATEGORIES[0].id as string,
    badges: '',
    featured: '50',
    weightGrams: '500',
    ratingAverage: '',
    ratingCount: '',
  })
  const [media, setMedia] = useState<unknown[]>([{ kind: 'render', shape: 'orb', hue: 210 }])
  const [specs, setSpecs] = useState<{ label: string; value: string }[]>([])
  const [variants, setVariants] = useState<VariantDraft[]>([blankVariant()])

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (isNew || !slug) return
    adminApi
      .getProduct(slug)
      .then((product) => {
        setForm({
          id: product.id,
          slug: product.slug,
          name: product.name,
          tagline: product.tagline,
          description: product.description,
          highlights: product.highlights.join('\n'),
          category: product.category,
          badges: (product.badges ?? []).join(', '),
          featured: String(product.featured ?? 0),
          weightGrams: String(product.weightGrams),
          ratingAverage: product.rating ? String(product.rating.average) : '',
          ratingCount: product.rating ? String(product.rating.count) : '',
        })
        setMedia(product.media)
        setSpecs(product.specs)
        setVariants(product.variants.map(toDraft))
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [slug, isNew])

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const payload = useMemo<ProductPayload>(() => {
    const price = (v: VariantDraft, kind: 'price' | 'stock') => {
      const out = {} as Record<RegionCode, number>
      for (const r of REGION_CODES) {
        out[r] = kind === 'price' ? majorToMinor(v.price[r], r) : Math.max(0, Math.round(Number(v.stock[r]) || 0))
      }
      return out
    }

    return {
      id: form.id || undefined,
      slug: form.slug || form.name,
      name: form.name,
      tagline: form.tagline,
      description: form.description,
      highlights: form.highlights.split('\n').map((h) => h.trim()).filter(Boolean),
      rating: form.ratingAverage
        ? { average: Number(form.ratingAverage), count: Number(form.ratingCount) || 0 }
        : null,
      category: form.category,
      badges: form.badges.split(',').map((b) => b.trim()).filter(Boolean),
      media,
      specs: specs.filter((s) => s.label && s.value),
      featured: Number(form.featured) || 0,
      weightGrams: Number(form.weightGrams) || 0,
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        label: v.label,
        options: {
          ...(v.size ? { size: v.size } : {}),
          ...(v.color ? { color: v.color } : {}),
          ...(v.colorHex ? { colorHex: v.colorHex } : {}),
        },
        price: price(v, 'price'),
        stock: price(v, 'stock'),
      })),
    } as unknown as ProductPayload
  }, [form, media, specs, variants])

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const result = form.id
        ? await adminApi.updateProduct(form.id, payload)
        : await adminApi.createProduct(payload)
      setForm((prev) => ({ ...prev, id: result.id, slug: result.slug }))
      setVariants(result.variants.map(toDraft))
      setSaved(true)
      if (isNew) navigate(`/admin/products/${result.slug}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="font-mono text-[12px] text-cream/45">Loading…</p>

  return (
    <>
      <AdminHeading
        title={isNew ? 'New product' : form.name || 'Product'}
        subtitle={form.slug ? `Live at /<store>/product/${form.slug}` : 'Not saved yet'}
        action={
          <div className="flex gap-2">
            <Link to="/admin">
              <AdminButton tone="ghost">Back</AdminButton>
            </Link>
            <AdminButton onClick={save} disabled={saving || !form.name}>
              {saving ? 'Saving…' : 'Save product'}
            </AdminButton>
          </div>
        }
      />

      {error && <Banner tone="error">{error}</Banner>}
      {saved && <Banner tone="ok">Saved. The change is live on the storefront now.</Banner>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={(e) => set('name')(e.target.value)} />
        </Field>
        <Field label="URL slug" hint="Leave blank to generate it from the name.">
          <input className={inputClass} value={form.slug} onChange={(e) => set('slug')(e.target.value)} />
        </Field>
        <Field label="Tagline" hint="The one line under the product name.">
          <input className={inputClass} value={form.tagline} onChange={(e) => set('tagline')(e.target.value)} />
        </Field>
        <Field label="Department">
          <select
            className={inputClass}
            value={form.category}
            onChange={(e) => set('category')(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id} className="bg-[#060d2e]">
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-5">
        <Field label="Description">
          <textarea
            rows={4}
            className={inputClass}
            value={form.description}
            onChange={(e) => set('description')(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Field label="Highlights" hint="One per line. These show as ticks on the product page.">
          <textarea
            rows={4}
            className={inputClass}
            value={form.highlights}
            onChange={(e) => set('highlights')(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4 self-start">
          <Field label="Badges" hint="Comma separated.">
            <input className={inputClass} value={form.badges} onChange={(e) => set('badges')(e.target.value)} />
          </Field>
          <Field label="Featured weight" hint="0–100. Higher sorts first.">
            <input className={inputClass} value={form.featured} onChange={(e) => set('featured')(e.target.value)} />
          </Field>
          <Field label="Rating" hint="Out of 5. Leave blank for none.">
            <input
              className={inputClass}
              value={form.ratingAverage}
              onChange={(e) => set('ratingAverage')(e.target.value)}
            />
          </Field>
          <Field label="Review count">
            <input
              className={inputClass}
              value={form.ratingCount}
              onChange={(e) => set('ratingCount')(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* ------------------------------------------------- variants */}
      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-grotesk text-[15px] uppercase text-cream">
            Variants, prices and stock
          </h2>
          <AdminButton tone="ghost" onClick={() => setVariants((v) => [...v, blankVariant()])}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={13} /> Add variant
            </span>
          </AdminButton>
        </div>
        <p className="mb-4 font-mono text-[11px] leading-relaxed text-cream/45">
          Each store is priced separately — there is no exchange rate. Enter prices the way a customer
          reads them ({REGIONS.us.currency.symbol}289.00, AED 1060.00, Rs 79900).
        </p>

        <div className="space-y-4">
          {variants.map((variant, index) => (
            <div key={index} className="rounded-[14px] border border-white/10 bg-white/[0.02] p-4">
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Field label="SKU">
                  <input
                    className={inputClass}
                    value={variant.sku}
                    onChange={(e) =>
                      setVariants((vs) => vs.map((v, i) => (i === index ? { ...v, sku: e.target.value } : v)))
                    }
                  />
                </Field>
                <Field label="Label">
                  <input
                    className={inputClass}
                    value={variant.label}
                    onChange={(e) =>
                      setVariants((vs) => vs.map((v, i) => (i === index ? { ...v, label: e.target.value } : v)))
                    }
                  />
                </Field>
                <Field label="Size">
                  <input
                    className={inputClass}
                    value={variant.size}
                    onChange={(e) =>
                      setVariants((vs) => vs.map((v, i) => (i === index ? { ...v, size: e.target.value } : v)))
                    }
                  />
                </Field>
                <Field label="Colour">
                  <input
                    className={inputClass}
                    value={variant.color}
                    onChange={(e) =>
                      setVariants((vs) => vs.map((v, i) => (i === index ? { ...v, color: e.target.value } : v)))
                    }
                  />
                </Field>
                <Field label="Colour hex">
                  <input
                    className={inputClass}
                    placeholder="#16181d"
                    value={variant.colorHex}
                    onChange={(e) =>
                      setVariants((vs) => vs.map((v, i) => (i === index ? { ...v, colorHex: e.target.value } : v)))
                    }
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {REGION_CODES.map((region) => (
                  <div key={region} className="rounded-[10px] border border-white/10 p-3">
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-cream/50">
                      {REGIONS[region].country} · {REGIONS[region].currency.code}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Price">
                        <input
                          className={inputClass}
                          value={variant.price[region]}
                          onChange={(e) =>
                            setVariants((vs) =>
                              vs.map((v, i) =>
                                i === index ? { ...v, price: { ...v.price, [region]: e.target.value } } : v,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label="Stock">
                        <input
                          className={inputClass}
                          value={variant.stock[region]}
                          onChange={(e) =>
                            setVariants((vs) =>
                              vs.map((v, i) =>
                                i === index ? { ...v, stock: { ...v.stock, [region]: e.target.value } } : v,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>

              {variants.length > 1 && (
                <div className="mt-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          'Remove this variant? Its stock counts in all three stores go with it.',
                        )
                      ) {
                        setVariants((vs) => vs.filter((_, i) => i !== index))
                      }
                    }}
                    className="font-mono text-[10px] uppercase text-cream/35 hover:text-red-300"
                  >
                    Remove variant
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ---------------------------------------------------- specs */}
      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-grotesk text-[15px] uppercase text-cream">Specifications</h2>
          <AdminButton
            tone="ghost"
            onClick={() => setSpecs((s) => [...s, { label: '', value: '' }])}
          >
            <span className="inline-flex items-center gap-1.5">
              <Plus size={13} /> Add row
            </span>
          </AdminButton>
        </div>
        <div className="space-y-2">
          {specs.map((spec, index) => (
            <div key={index} className="flex gap-2">
              <input
                className={inputClass}
                placeholder="Height"
                value={spec.label}
                onChange={(e) =>
                  setSpecs((ss) => ss.map((s, i) => (i === index ? { ...s, label: e.target.value } : s)))
                }
              />
              <input
                className={inputClass}
                placeholder="180 mm"
                value={spec.value}
                onChange={(e) =>
                  setSpecs((ss) => ss.map((s, i) => (i === index ? { ...s, value: e.target.value } : s)))
                }
              />
              <button
                type="button"
                onClick={() => setSpecs((ss) => ss.filter((_, i) => i !== index))}
                className="flex-none px-2 text-cream/30 hover:text-red-300"
                aria-label="Remove specification"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {specs.length === 0 && (
            <p className="font-mono text-[11px] text-cream/35">No specifications yet.</p>
          )}
        </div>
      </div>

      <div className="mt-10 border-t border-white/10 pt-5">
        <AdminButton onClick={save} disabled={saving || !form.name}>
          {saving ? 'Saving…' : 'Save product'}
        </AdminButton>
      </div>
    </>
  )
}
