import { Link } from 'react-router-dom'
import { Mail, Phone } from 'lucide-react'
import { CATEGORIES } from '../api/db'
import Newsletter from './Newsletter'
import { useRegion } from '../regions/RegionContext'
import { REGION_LIST } from '../regions/config'
import Flag from './ui/Flag'

/**
 * The footer is where a storefront proves it is a real business in a
 * real market: the trading entity, its registration, the local support
 * line, the returns window and the payment methods that market accepts.
 * All three differ, and all three come from the region config.
 */
export default function Footer() {
  const { config, href, setRegion, region } = useRegion()

  return (
    <footer className="border-t border-ink/10 bg-background">
      <div className="mx-auto max-w-[1600px] px-4 py-14 sm:px-6 lg:px-10">
        <div className="grid grid-cols-2 gap-10 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-2">
            <div className="font-grotesk text-[20px] uppercase text-ink">
              Orbis <span className="text-muted">Store</span>
            </div>
            <p className="mt-3 max-w-xs font-mono text-[12px] leading-relaxed text-muted">
              Collectible Orbis figures, plus the homeware, lighting, apparel and prints that go with
              them. Shipping across {config.country} from our local warehouse.
            </p>

            <div className="mt-6 space-y-2">
              <a
                href={`mailto:${config.support.email}`}
                className="flex items-center gap-2 font-mono text-[12px] text-ink/80 hover:text-accent"
              >
                <Mail size={13} /> {config.support.email}
              </a>
              <a
                href={`tel:${config.support.phone.replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-2 font-mono text-[12px] text-ink/80 hover:text-accent"
              >
                <Phone size={13} /> {config.support.phone}
              </a>
              <div className="font-mono text-[11px] text-muted">{config.support.hours}</div>
            </div>
          </div>

          <div>
            <h3 className="font-grotesk text-[12px] uppercase tracking-wide text-ink">Shop</h3>
            <ul className="mt-4 space-y-2">
              <li>
                <Link to={href('/shop')} className="font-mono text-[12px] text-muted hover:text-accent">
                  All products
                </Link>
              </li>
              {CATEGORIES.map((cat) => (
                <li key={cat.id}>
                  <Link
                    to={href(`/shop/${cat.id}`)}
                    className="font-mono text-[12px] text-muted hover:text-accent"
                  >
                    {cat.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-grotesk text-[12px] uppercase tracking-wide text-ink">
              Delivery &amp; returns
            </h3>
            <ul className="mt-4 space-y-2 font-mono text-[12px] text-muted">
              <li>{config.policy.returnsDays}-day returns</li>
              <li>{config.policy.warrantyMonths}-month warranty</li>
              <li>{config.taxNote}</li>
              <li>
                <Link to={href('/orders')} className="hover:text-accent">
                  Track an order
                </Link>
              </li>
              <li>
                <Link to={href('/help')} className="hover:text-accent">
                  Delivery &amp; returns FAQ
                </Link>
              </li>
            </ul>
            <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">
              {config.policy.dutiesNote}
            </p>
          </div>

          <div>
            <h3 className="font-grotesk text-[12px] uppercase tracking-wide text-ink">We accept</h3>
            <ul className="mt-4 space-y-2">
              {config.paymentMethods.map((method) => (
                <li key={method.id} className="font-mono text-[12px] text-muted">
                  {method.label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* newsletter */}
        <div className="mt-12 border-t border-ink/10 pt-10">
          <div className="max-w-md">
            <Newsletter />
          </div>
        </div>

        {/* the three storefronts, always reachable */}
        <div className="mt-12 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-8">
          <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            Other stores
          </span>
          {REGION_LIST.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => setRegion(r.code)}
              disabled={r.code === region}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase transition-colors ${
                r.code === region
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-ink/15 text-muted hover:border-ink/35 hover:text-ink'
              }`}
            >
              <Flag code={r.code} className="h-3 w-[18px]" />
              <span>
                {r.country} · {r.currency.code}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-2 font-mono text-[11px] leading-relaxed text-muted sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-muted">{config.entity.name}</div>
            {config.entity.addressLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div className="mt-1">{config.entity.registration}</div>
          </div>
          <div className="sm:text-right">
            <div>© {new Date().getFullYear()} Orbis Store</div>
            <div>Prices shown in {config.currency.code}</div>
          </div>
        </div>
      </div>
    </footer>
  )
}
