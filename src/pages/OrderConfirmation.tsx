import { Link, useParams } from 'react-router-dom'
import { Check, Mail, MapPin, Package, Wallet } from 'lucide-react'
import { api } from '../api/client'
import { useAsync } from '../lib/useAsync'
import { useRegion } from '../regions/RegionContext'
import { formatMoney } from '../lib/money'
import { TotalsRows } from '../components/OrderSummary'
import { ErrorState } from '../components/ui/Atoms'
import { Seo } from '../lib/seo'

export default function OrderConfirmation() {
  const { number = '' } = useParams()
  const { config, href } = useRegion()
  const state = useAsync(() => api.getOrder(number), [number])

  if (state.loading) {
    return (
      <div className="mx-auto max-w-3xl animate-pulse px-4 py-24">
        <div className="mx-auto h-12 w-12 rounded-full bg-ink/10" />
        <div className="mx-auto mt-6 h-8 w-2/3 rounded bg-ink/10" />
        <div className="mx-auto mt-4 h-4 w-1/3 rounded bg-ink/5" />
        <div className="mt-10 h-64 rounded-[20px] bg-ink/5" />
      </div>
    )
  }

  if (state.error || !state.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24">
        <ErrorState message={state.error ?? 'Order not found.'} />
        <div className="mt-6 text-center">
          <Link to={href('/orders')} className="font-body text-[12px] uppercase text-accent underline underline-offset-4">
            Look up another order
          </Link>
        </div>
      </div>
    )
  }

  const order = state.data
  const placed = new Date(order.placedAt)
  const offlinePayment = order.paymentStatus === 'due_on_delivery'
  const awaitingPayment = order.paymentStatus === 'pending'

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-16 sm:px-6">
      <Seo
        title={'Order ' + order.number}
        description="Your Orbis Store order is confirmed."
        path={'/order/' + order.number}
        noindex
      />
      <div className="text-center">
        <span className="animate-scale-in mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-neon text-ink">
          <Check size={26} strokeWidth={3} />
        </span>
        <h1 className="mt-6 font-grotesk text-[30px] uppercase leading-tight text-ink sm:text-[40px]">
          Order confirmed
        </h1>
        <p className="mt-3 font-body text-[12px] uppercase text-muted">
          {order.number} · {placed.toLocaleDateString(config.locale, { dateStyle: 'long' })}
        </p>
        <p className="mx-auto mt-4 max-w-md font-body text-[12px] leading-relaxed text-muted">
          A confirmation is on its way to {order.email}. Keep the order number — it is how we find
          you if you need to change anything.
        </p>
      </div>

      {/* what happens next, which genuinely differs by market */}
      <div className="mt-10 rounded-[18px] border border-accent/30 bg-accent/[0.05] p-5">
        <h2 className="mb-2 font-grotesk text-[13px] uppercase text-accent">What happens next</h2>
        <p className="font-body text-[12px] leading-relaxed text-ink/80">
          {order.paymentMethodId === 'cod' ? (
            <>
              Have {formatMoney(order.totals.total, config, false)} ready in cash. Your order ships{' '}
              {order.shipping.label.toLowerCase()} and arrives in {order.shipping.eta.toLowerCase()} —
              the rider will call {order.address.phone} before arriving.
            </>
          ) : order.paymentMethodId === 'bank' ? (
            <>
              We have emailed our IBAN and this order number to {order.email}. Your order is held for
              48 hours and ships as soon as the transfer clears.
            </>
          ) : awaitingPayment ? (
            <>
              Your order is reserved, but <strong className="text-ink">no card has been charged</strong> —
              this store has no live payment gateway connected yet. We will email {order.email} to
              settle payment, and it ships {order.shipping.label.toLowerCase()} once that is done.
            </>
          ) : (
            <>
              Your payment is confirmed. The order is packed at our {config.country} warehouse and
              ships {order.shipping.label.toLowerCase()} — {order.shipping.eta.toLowerCase()}. Tracking
              follows by email.
            </>
          )}
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* items */}
        <div className="rounded-[20px] border border-ink/10 bg-ink/[0.02] p-6">
          <h2 className="mb-5 font-grotesk text-[13px] uppercase text-ink">
            {order.lines.length} item{order.lines.length === 1 ? '' : 's'}
          </h2>
          <ul className="divide-y divide-ink/10">
            {order.lines.map((line) => (
              <li key={line.sku} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="font-grotesk text-[12px] uppercase text-ink">{line.productName}</div>
                  <div className="mt-0.5 font-body text-[10px] uppercase text-muted">
                    {line.variantLabel} · {line.sku} · Qty {line.quantity}
                  </div>
                </div>
                <div className="flex-none font-body text-[12px] text-ink">
                  {formatMoney(line.lineTotal, config, false)}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 grid grid-cols-1 gap-5 border-t border-ink/10 pt-6 sm:grid-cols-2">
            <Block icon={MapPin} title="Delivering to">
              {order.address.fullName}
              <br />
              {order.address.line1}
              {order.address.line2 && (
                <>
                  <br />
                  {order.address.line2}
                </>
              )}
              <br />
              {order.address.city}
              {order.address.postalCode ? `, ${order.address.postalCode}` : ''}
              <br />
              {order.address.region}, {config.country}
              <br />
              {order.address.phone}
            </Block>

            <Block icon={Package} title="Delivery method">
              {order.shipping.label}
              <br />
              {order.shipping.eta}
              <br />
              {order.shipping.amount === 0 ? 'Free' : formatMoney(order.shipping.amount, config, false)}
            </Block>

            <Block icon={Wallet} title="Payment">
              {order.paymentMethodLabel}
              {offlinePayment && (
                <>
                  <br />
                  <span className="text-amber-300">Due on delivery</span>
                </>
              )}
              {awaitingPayment && (
                <>
                  <br />
                  <span className="text-amber-300">Not yet charged</span>
                </>
              )}
              {order.paymentStatus === 'paid' && (
                <>
                  <br />
                  <span className="text-accent">Paid</span>
                </>
              )}
            </Block>

            <Block icon={Mail} title="Contact">
              {order.email}
              <br />
              {config.support.email}
              <br />
              {config.support.hours}
            </Block>
          </div>
        </div>

        {/* totals */}
        <aside>
          <div className="rounded-[20px] border border-ink/10 bg-ink/[0.02] p-6">
            <h2 className="mb-5 font-grotesk text-[13px] uppercase text-ink">Total paid</h2>
            <TotalsRows totals={order.totals} />
            {order.promoCode && (
              <p className="mt-3 font-body text-[10px] uppercase text-accent">Code {order.promoCode} applied</p>
            )}
            {order.paymentInstructions && (
              <p className="mt-3 font-body text-[10px] leading-relaxed text-amber-200/80">
                {order.paymentInstructions}
              </p>
            )}
            <p className="mt-5 font-body text-[10px] leading-relaxed text-muted">
              {config.policy.returnsDays}-day returns ·{' '}
              {config.entity.name} · {config.entity.registration}
            </p>
          </div>

          <Link
            to={href('/shop')}
            className="mt-4 block rounded-full border border-ink/20 py-3 text-center font-grotesk text-[12px] uppercase text-ink transition-colors hover:border-ink/45"
          >
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  )
}

function Block({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof MapPin
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-body text-[10px] uppercase tracking-wide text-muted">
        <Icon size={12} /> {title}
      </div>
      <div className="font-body text-[11px] leading-relaxed text-ink/80">{children}</div>
    </div>
  )
}
