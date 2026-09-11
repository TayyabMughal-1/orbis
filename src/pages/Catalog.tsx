import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, type SortKey } from '../api/client'
import { CATEGORIES } from '../api/db'
import { useAsync } from '../lib/useAsync'
import { useRegion } from '../regions/RegionContext'
import ProductCard from '../components/ProductCard'
import { RevealGroup } from '../components/ui/Reveal'
import { EmptyState, ErrorState, ProductGridSkeleton } from '../components/ui/Atoms'
import { Seo, absoluteUrl, breadcrumbSchema, graph } from '../lib/seo'
import type { Category } from '../types'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'featured', label: 'Featured' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'name', label: 'A–Z' },
]

export default function Catalog() {
  const { category } = useParams<{ category?: string }>()
  const [params, setParams] = useSearchParams()
  const { region, config, href } = useRegion()

  const search = params.get('q') ?? ''
  const sort = (params.get('sort') as SortKey) ?? 'featured'
  const inStockOnly = params.get('stock') === '1'

  const active = CATEGORIES.find((c) => c.id === category)
  const categoryFilter: Category | 'all' = active ? active.id : 'all'

  const state = useAsync(
    () => api.listProducts({ region, category: categoryFilter, sort, search, inStockOnly }),
    [region, categoryFilter, sort, search, inStockOnly],
  )

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(params)
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const title = active ? active.label : search ? `“${search}”` : 'Everything'
  const path = active ? `/shop/${active.id}` : '/shop'

  // A search results page is useful to a shopper but not something a
  // search engine should index — it would compete with the category
  // pages for the same terms.
  const schema = search
    ? undefined
    : graph(
        breadcrumbSchema(config, [
          { name: config.storeName, path: '/' },
          { name: 'Shop', path: '/shop' },
          ...(active ? [{ name: active.label, path }] : []),
        ]),
        state.data && state.data.length
          ? {
              '@type': 'ItemList',
              name: `${title} — Orbis Store ${config.countryCode}`,
              numberOfItems: state.data.length,
              itemListElement: state.data.map((product, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                url: absoluteUrl(config.code, `/product/${product.slug}`),
                name: product.name,
              })),
            }
          : null,
      )

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-12 sm:px-6 lg:px-10">
      <Seo
        title={
          active
            ? `${active.label} — delivered in ${config.country}`
            : search
              ? `Search results for “${search}”`
              : `Shop all products in ${config.country}`
        }
        description={
          active
            ? `${active.blurb} Priced in ${config.currency.code}, delivered across ${config.country} with ${config.policy.returnsDays}-day returns.`
            : `Every Orbis figure, light, print and garment we ship to ${config.country}. Prices in ${config.currency.code}, ${config.taxNote.toLowerCase()}.`
        }
        path={path}
        noindex={Boolean(search)}
        jsonLd={schema}
      />
      <nav className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase text-cream/40">
        <Link to={href('/')} className="hover:text-cream">
          {config.storeName}
        </Link>
        <span>/</span>
        <Link to={href('/shop')} className="hover:text-cream">
          Shop
        </Link>
        {active && (
          <>
            <span>/</span>
            <span className="text-cream/70">{active.label}</span>
          </>
        )}
      </nav>

      <div className="mb-8 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-grotesk text-[34px] uppercase leading-none text-cream sm:text-[46px]">
            {title}
          </h1>
          <p className="mt-3 max-w-lg font-mono text-[12px] leading-relaxed text-cream/55">
            {active ? active.blurb : `Every piece we ship to ${config.country}, priced in ${config.currency.code}.`}
          </p>
        </div>
        <div className="font-mono text-[11px] uppercase text-cream/40">
          {state.data ? `${state.data.length} product${state.data.length === 1 ? '' : 's'}` : '—'}
        </div>
      </div>

      {/* category chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          to={href('/shop')}
          className={`rounded-full border px-4 py-2 font-mono text-[11px] uppercase transition-colors ${
            !active ? 'border-neon/50 bg-neon/10 text-neon' : 'border-white/15 text-cream/60 hover:border-white/35'
          }`}
        >
          All
        </Link>
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.id}
            to={href(`/shop/${cat.id}`)}
            className={`rounded-full border px-4 py-2 font-mono text-[11px] uppercase transition-colors ${
              active?.id === cat.id
                ? 'border-neon/50 bg-neon/10 text-neon'
                : 'border-white/15 text-cream/60 hover:border-white/35'
            }`}
          >
            {cat.label}
          </Link>
        ))}
      </div>

      {/* sort + stock */}
      <div className="mb-10 flex flex-wrap items-center gap-3 border-y border-white/10 py-3">
        <label className="flex items-center gap-2 font-mono text-[11px] uppercase text-cream/50">
          Sort
          <select
            value={sort}
            onChange={(e) => updateParam('sort', e.target.value)}
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-cream outline-none focus:border-white/40"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#060d2e]">
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] uppercase text-cream/50">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => updateParam('stock', e.target.checked ? '1' : null)}
            className="h-3.5 w-3.5 accent-[#6FFF00]"
          />
          In stock only
        </label>

        {search && (
          <button
            type="button"
            onClick={() => updateParam('q', null)}
            className="ml-auto rounded-full border border-white/15 px-3 py-1.5 font-mono text-[11px] uppercase text-cream/60 hover:border-white/35"
          >
            Clear “{search}” ×
          </button>
        )}
      </div>

      {state.loading && <ProductGridSkeleton count={6} />}
      {state.error && <ErrorState message={state.error} onRetry={state.reload} />}
      {state.data && state.data.length === 0 && (
        <EmptyState
          title="Nothing matched"
          body={
            search
              ? `We could not find anything for “${search}” in the ${config.country} store. Try a broader term.`
              : 'No products match these filters right now.'
          }
          action={
            <Link
              to={href('/shop')}
              className="rounded-full bg-neon px-6 py-2.5 font-grotesk text-[12px] uppercase text-background"
            >
              Browse everything
            </Link>
          }
        />
      )}
      {state.data && state.data.length > 0 && (
        <RevealGroup
          key={`${categoryFilter}-${sort}-${search}`}
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {state.data.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </RevealGroup>
      )}
    </div>
  )
}
