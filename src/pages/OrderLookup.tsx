import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Search } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import { useRegion } from '../regions/RegionContext'
import { formatMoney } from '../lib/money'
import { EmptyState } from '../components/ui/Atoms'
import { Seo } from '../lib/seo'
import type { Order } from '../types'

export default function OrderLookup() {
  const { region, config, href } = useRegion()
  const navigate = useNavigate()

  const [number, setNumber] = useState('')
  const [email, setEmail] = useState('')
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function findByNumber(event: FormEvent) {
    event.preventDefault()
    const value = number.trim().toUpperCase()
    if (value) navigate(href(`/order/${value}`))
  }

  async function findByEmail(event: FormEvent) {
    event.preventDefault()
    const value = email.trim()
    if (!value) return

    setLoading(true)
    setError(null)
    try {
      setOrders(await api.listOrders(region, value))
    } catch (err) {
      setError(errorMessage(err))
      setOrders(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-4 py-16 sm:px-6">
      <Seo
        title={`Track an order in ${config.country}`}
        description={`Enter your Orbis Store order number to see its status, delivery method and expected arrival in ${config.country}.`}
        path="/orders"
      />

      <h1 className="font-grotesk text-[34px] uppercase leading-none text-ink sm:text-[44px]">
        Track an order
      </h1>
      <p className="mt-3 max-w-xl font-body text-[12px] leading-relaxed text-muted">
        Orders live in the store they were placed in — a {config.country} order will not appear in the
        other two.
      </p>

      {/* by order number */}
      <form onSubmit={findByNumber} className="mt-8">
        <label
          htmlFor="order-number"
          className="mb-2 block font-body text-[10px] uppercase tracking-wide text-muted"
        >
          Order number
        </label>
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-ink/15 bg-ink/5 px-4">
            <Search size={15} className="flex-none text-muted" />
            <input
              id="order-number"
              value={number}
              onChange={(e) => setNumber(e.target.value.toUpperCase())}
              placeholder={`ORB-${config.countryCode}-XXXXXX`}
              className="w-full bg-transparent py-3 font-body text-[13px] text-ink outline-none placeholder:text-muted"
            />
          </div>
          <button
            type="submit"
            disabled={!number.trim()}
            className="press flex-none rounded-full bg-neon px-6 py-3 font-grotesk text-[12px] uppercase text-ink disabled:opacity-35"
          >
            Find
          </button>
        </div>
      </form>

      {/* by email */}
      <form onSubmit={findByEmail} className="mt-8 border-t border-ink/10 pt-8">
        <label
          htmlFor="order-email"
          className="mb-2 block font-body text-[10px] uppercase tracking-wide text-muted"
        >
          Or list every order for an email address
        </label>
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-ink/15 bg-ink/5 px-4">
            <Mail size={15} className="flex-none text-muted" />
            <input
              id="order-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-transparent py-3 font-body text-[13px] text-ink outline-none placeholder:text-muted"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="press flex-none rounded-full border border-ink/20 px-6 py-3 font-grotesk text-[12px] uppercase text-ink transition-colors hover:border-ink/45 disabled:opacity-35"
          >
            {loading ? 'Looking…' : 'List orders'}
          </button>
        </div>
        <p className="mt-2 font-body text-[10px] leading-relaxed text-muted">
          We only ever list orders for the address they were placed with.
        </p>
      </form>

      {error && (
        <p className="mt-6 rounded-[12px] border border-red-400/30 bg-red-500/10 p-3 font-body text-[11px] text-red-200">
          {error}
        </p>
      )}

      {orders && orders.length === 0 && (
        <div className="mt-10">
          <EmptyState
            title="No orders found"
            body={`We have no orders for ${email.trim()} in the ${config.country} store.`}
            action={
              <Link
                to={href('/shop')}
                className="press rounded-full bg-neon px-6 py-2.5 font-grotesk text-[12px] uppercase text-ink"
              >
                Start shopping
              </Link>
            }
          />
        </div>
      )}

      {orders && orders.length > 0 && (
        <>
          <h2 className="mb-4 mt-12 font-grotesk text-[14px] uppercase text-ink">
            {orders.length} order{orders.length === 1 ? '' : 's'}
          </h2>
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {orders.map((order) => (
              <li key={order.number}>
                <Link
                  to={href(`/order/${order.number}`)}
                  className="flex flex-wrap items-center justify-between gap-3 py-4 transition-colors hover:bg-ink/[0.03]"
                >
                  <div>
                    <div className="font-grotesk text-[13px] uppercase text-ink">{order.number}</div>
                    <div className="mt-1 font-body text-[11px] text-muted">
                      {new Date(order.placedAt).toLocaleDateString(config.locale, { dateStyle: 'medium' })} ·{' '}
                      {order.lines.length} item{order.lines.length === 1 ? '' : 's'} ·{' '}
                      {order.paymentMethodLabel}
                    </div>
                  </div>
                  <div className="font-body text-[13px] text-accent">
                    {formatMoney(order.totals.total, config, false)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
