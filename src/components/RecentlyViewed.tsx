import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAsync } from '../lib/useAsync'
import { useRecentlyViewed } from '../lib/useRecentlyViewed'
import { useRegion } from '../regions/RegionContext'
import Media from './ui/Media'
import Price from './ui/Price'

/**
 * A quiet row of what this shopper has already looked at. Its job is to
 * make backtracking cheap — the single most common thing people do when
 * comparing two pieces.
 */
export default function RecentlyViewed({ excludeId }: { excludeId?: string }) {
  const { region, href } = useRegion()
  const ids = useRecentlyViewed()
  const state = useAsync(() => api.listProducts({ region }), [region])

  const items = (state.data ?? [])
    .filter((p) => ids.includes(p.id) && p.id !== excludeId)
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    .slice(0, 6)

  if (items.length === 0) return null

  return (
    <section className="mx-auto max-w-[1600px] px-4 pb-20 sm:px-6 lg:px-10">
      <h2 className="mb-6 font-grotesk text-[16px] uppercase text-ink">Recently viewed</h2>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {items.map((product) => {
          const from = Math.min(...product.variants.map((v) => v.price[region]))
          return (
            <Link
              key={product.id}
              to={href(`/product/${product.slug}`)}
              className="group w-[160px] flex-none sm:w-[180px]"
            >
              <div className="aspect-square overflow-hidden rounded-[16px] bg-surface">
                <Media
                  item={product.media[0]}
                  autoPlay={false}
                  className="transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="mt-2.5 truncate font-grotesk text-[13px] uppercase text-ink group-hover:text-accent">
                {product.name}
              </div>
              <Price amount={from} className="font-body text-[13px] text-muted" />
            </Link>
          )
        })}
      </div>
    </section>
  )
}
