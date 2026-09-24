import { Link } from 'react-router-dom'
import { useRegion } from '../regions/RegionContext'
import { CATEGORIES } from '../api/db'
import { Seo } from '../lib/seo'

export default function NotFound() {
  const { config, href } = useRegion()

  return (
    <div className="mx-auto max-w-[700px] px-4 py-28 text-center sm:px-6">
      <Seo
        title="Page not found"
        description="That page could not be found."
        path="/404"
        noindex
      />
      <div className="font-grotesk text-[64px] uppercase leading-none text-ink sm:text-[92px]">404</div>
      <h1 className="mt-4 font-grotesk text-[20px] uppercase text-ink sm:text-[26px]">
        That page drifted off
      </h1>
      <p className="mx-auto mt-4 max-w-sm font-body text-[14px] leading-relaxed text-muted">
        We could not find that page in the {config.country} store. It may have moved, or the run may
        have sold out and been retired.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Link
          to={href('/shop')}
          className="rounded-full bg-neon px-6 py-2.5 font-grotesk text-[14px] uppercase text-ink"
        >
          Shop everything
        </Link>
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.id}
            to={href(`/shop/${cat.id}`)}
            className="rounded-full border border-ink/18 px-5 py-2.5 font-body text-[13px] uppercase text-muted transition-colors hover:border-ink/40 hover:text-ink"
          >
            {cat.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
