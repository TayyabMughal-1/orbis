import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Package } from 'lucide-react'
import { accountApi, getToken, type Customer } from '../api/account'
import { errorMessage } from '../api/client'
import { useRegion } from '../regions/RegionContext'
import { useAsync } from '../lib/useAsync'
import { Seo } from '../lib/seo'
import { ErrorState } from '../components/ui/Atoms'
import { REGIONS } from '../regions/config'
import { formatMoney } from '../lib/money'

// ---------------------------------------------------------------------
// The shopper's account.
//
// An account is a convenience over orders that already exist, never a
// gate in front of them: checkout does not require one, and history is
// matched on the email address the order was placed with. Registering
// after ordering therefore surfaces the earlier orders, which is what
// someone expects and what a customers-to-orders foreign key would have
// prevented.
// ---------------------------------------------------------------------

const field =
  'w-full rounded-[12px] border border-ink/15 bg-background px-4 py-3 font-body text-[13px] text-ink outline-none transition-colors focus:border-accent'

export default function Account() {
  const { region, href } = useRegion()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [checking, setChecking] = useState(Boolean(getToken()))

  // A token in storage is not proof of a live session — it may have been
  // revoked or the account deleted — so it is confirmed against the API
  // before the page commits to showing an account.
  useEffect(() => {
    if (!getToken()) return
    let alive = true
    accountApi
      .me()
      .then((c) => alive && setCustomer(c))
      .catch(() => alive && setCustomer(null))
      .finally(() => alive && setChecking(false))
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      <Seo
        title="Your account"
        description="Sign in to see your Orbis orders."
        path="/account"
        noindex
      />
      <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 lg:px-10">
        {checking ? (
          <p className="font-body text-[12px] text-muted">Checking your session…</p>
        ) : customer ? (
          <SignedIn
            customer={customer}
            onSignOut={() => {
              accountApi.logout()
              setCustomer(null)
            }}
            shopHref={href('/shop')}
          />
        ) : (
          <SignInOrRegister region={region} onSignedIn={setCustomer} />
        )}
      </div>
    </>
  )
}

function SignInOrRegister({
  region,
  onSignedIn,
}: {
  region: Customer['region']
  onSignedIn: (c: Customer) => void
}) {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const customer =
        mode === 'in'
          ? await accountApi.login(email, password)
          : await accountApi.register({ email, password, name, region: region ?? undefined })
      onSignedIn(customer)
    } catch (err) {
      setError(errorMessage(err))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[440px]">
      <h1 className="font-grotesk text-[30px] uppercase leading-[1.05] text-ink sm:text-[38px]">
        {mode === 'in' ? 'Sign in' : 'Create an account'}
      </h1>
      <p className="mt-3 font-body text-[12px] leading-relaxed text-muted">
        {mode === 'in'
          ? 'To see everything you have ordered, in every store.'
          : 'Orders you have already placed with this email will appear straight away.'}
      </p>

      <form onSubmit={submit} className="mt-8 grid gap-3">
        {mode === 'up' && (
          <input
            className={field}
            placeholder="Name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <input
          className={field}
          type="email"
          required
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className={field}
          type="password"
          required
          placeholder={mode === 'up' ? 'Password — at least 8 characters' : 'Password'}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p className="rounded-[10px] border border-red-500/25 bg-red-50 p-3 font-body text-[11px] leading-relaxed text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="press mt-1 rounded-full bg-ink py-3.5 font-grotesk text-[13px] uppercase text-background disabled:opacity-40"
        >
          {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'in' ? 'up' : 'in')
          setError(null)
        }}
        className="mt-5 font-body text-[11px] text-muted underline hover:text-ink"
      >
        {mode === 'in' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
      </button>
    </div>
  )
}

function SignedIn({
  customer,
  onSignOut,
  shopHref,
}: {
  customer: Customer
  onSignOut: () => void
  shopHref: string
}) {
  const load = useCallback(() => accountApi.orders(), [])
  const orders = useAsync(load, [])

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-body text-[11px] uppercase tracking-[0.2em] text-muted">
            Your account
          </div>
          <h1 className="mt-2 font-grotesk text-[30px] uppercase leading-[1.05] text-ink sm:text-[38px]">
            {customer.name || customer.email}
          </h1>
          {customer.name && (
            <p className="mt-1 font-body text-[12px] text-muted">{customer.email}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="press inline-flex items-center gap-2 rounded-full border border-ink/20 px-5 py-2.5 font-grotesk text-[12px] uppercase text-ink transition-colors hover:border-ink/45"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>

      <h2 className="mt-12 font-grotesk text-[16px] uppercase text-ink">Purchase history</h2>

      {orders.loading && <p className="mt-4 font-body text-[12px] text-muted">Loading…</p>}
      {orders.error && (
        <div className="mt-4">
          <ErrorState message={orders.error} onRetry={orders.reload} />
        </div>
      )}

      {orders.data && orders.data.length === 0 && (
        <div className="mt-6 rounded-[18px] border border-ink/[0.07] bg-surface p-8 text-center">
          <Package size={20} className="mx-auto text-muted" strokeWidth={1.6} />
          <p className="mt-3 font-body text-[12px] leading-relaxed text-muted">
            Nothing here yet. Anything you order with{' '}
            <span className="text-ink">{customer.email}</span> will show up on this page.
          </p>
          <Link
            to={shopHref}
            className="press mt-5 inline-block rounded-full bg-neon px-6 py-2.5 font-grotesk text-[12px] uppercase text-ink"
          >
            Start shopping
          </Link>
        </div>
      )}

      {orders.data && orders.data.length > 0 && (
        <ul className="mt-6 grid gap-3">
          {orders.data.map((order) => {
            // History spans stores, so each row is priced in the currency it
            // was actually bought in rather than the one being browsed.
            const config = REGIONS[order.region]
            return (
              <li
                key={order.number}
                className="rounded-[18px] border border-ink/[0.07] bg-background p-5 shadow-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link
                      to={`/${order.region}/order/${order.number}`}
                      className="font-grotesk text-[13px] uppercase text-ink hover:text-accent"
                    >
                      {order.number}
                    </Link>
                    <div className="mt-1 font-body text-[11px] text-muted">
                      {new Date(order.placedAt).toLocaleDateString(config.locale, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {' · '}
                      {order.lines.length} item{order.lines.length === 1 ? '' : 's'}
                      {' · '}
                      <span className="uppercase">{order.region}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    {/* formatMoney, not <Price>: Price renders in the
                        region being browsed, and this row has to show the
                        currency the order was actually paid in. */}
                    <div className="font-body text-[14px] text-ink">
                      {formatMoney(order.totals.total, config)}
                    </div>
                    <div className="mt-1 font-body text-[10px] uppercase tracking-wide text-muted">
                      {order.status}
                    </div>
                  </div>
                </div>
                <div className="mt-3 truncate font-body text-[11px] text-muted">
                  {order.lines.map((l) => l.productName).join(' · ')}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
