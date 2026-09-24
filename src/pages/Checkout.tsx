import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Lock } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import { useAsync } from '../lib/useAsync'
import { useCart } from '../context/CartContext'
import { useRegion } from '../regions/RegionContext'
import { usePromo } from '../lib/usePromo'
import { formatMoney } from '../lib/money'
import { STORAGE_KEYS, removeKey } from '../lib/storage'
import Media from '../components/ui/Media'
import { PromoField, TotalsRows } from '../components/OrderSummary'
import { EmptyState } from '../components/ui/Atoms'
import { Seo } from '../lib/seo'
import type { Address } from '../types'
import Flag from '../components/ui/Flag'

type FormState = Omit<Address, 'countryCode'>
type Errors = Partial<Record<keyof FormState, string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function Checkout() {
  const { resolved, lines, subtotal, clear } = useCart()
  const { region, config, href } = useRegion()
  const promo = usePromo(subtotal)
  const navigate = useNavigate()

  const [form, setForm] = useState<FormState>({
    fullName: '',
    email: '',
    phone: '',
    line1: '',
    line2: '',
    city: '',
    region: '',
    postalCode: '',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [shippingId, setShippingId] = useState(config.shipping[0].id)
  const [paymentId, setPaymentId] = useState(config.paymentMethods[0].id)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // One key per checkout attempt. If the response is lost on the way
  // back — flaky connection, closed laptop — retrying returns the order
  // that was already created instead of placing a second one.
  const idempotencyKey = useRef(newIdempotencyKey())

  // The quote is re-fetched whenever anything that moves the number
  // changes — including the ship-to state, because US tax depends on it.
  const quote = useAsync(
    () =>
      api.quote({
        region,
        lines,
        shippingId,
        paymentMethodId: paymentId,
        promoCode: promo.code,
        subRegion: form.region || undefined,
      }),
    [region, JSON.stringify(lines), shippingId, paymentId, promo.code, form.region],
    { enabled: lines.length > 0 },
  )

  const selectedPayment = useMemo(
    () => config.paymentMethods.find((m) => m.id === paymentId) ?? config.paymentMethods[0],
    [config, paymentId],
  )

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  function validate(): boolean {
    const next: Errors = {}
    const fmt = config.address

    if (form.fullName.trim().length < 2) next.fullName = 'Please enter the full name for delivery.'
    if (!EMAIL_RE.test(form.email.trim())) next.email = 'We need a valid email for the order confirmation.'

    const digits = form.phone.replace(/[^\d]/g, '')
    if (!digits) next.phone = 'A phone number is required for delivery.'
    else if (!fmt.phonePattern.test(digits)) {
      next.phone = `That does not look like a ${config.country} number. Example: ${fmt.phonePlaceholder}`
    }

    if (form.line1.trim().length < 4) next.line1 = 'Please enter a street address.'
    if (form.city.trim().length < 2) next.city = 'Please enter a city.'
    // "a emirate" — let the possessive dodge the a/an problem entirely.
    if (!form.region) next.region = `Please choose your ${fmt.regionLabel.toLowerCase()}.`

    if (fmt.postalPattern) {
      if (!form.postalCode.trim()) next.postalCode = `${fmt.postalLabel} is required.`
      else if (!fmt.postalPattern.test(form.postalCode.trim())) {
        next.postalCode = `Example: ${fmt.postalPlaceholder}`
      }
    }

    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitError(null)
    if (!validate()) {
      document.querySelector('[data-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSubmitting(true)
    try {
      const order = await api.createOrder({
        idempotencyKey: idempotencyKey.current,
        region,
        lines,
        shippingId,
        paymentMethodId: paymentId,
        promoCode: promo.code,
        subRegion: form.region,
        address: {
          ...form,
          phone: `${config.address.phonePrefix} ${form.phone.replace(/[^\d]/g, '')}`,
          countryCode: config.countryCode,
        },
      })
      clear()
      removeKey(STORAGE_KEYS.promo(region))
      navigate(href(`/order/${order.number}`), { replace: true })
    } catch (err) {
      setSubmitError(errorMessage(err))
      setSubmitting(false)
    }
  }

  if (resolved.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
        <Seo title="Checkout" description="Complete your Orbis Store order." path="/checkout" noindex />
        <h1 className="mb-8 text-center font-grotesk text-[34px] uppercase text-ink">Checkout</h1>
        <EmptyState
          title="There is nothing to check out"
          body="Your cart is empty. Add something first and we will take it from there."
          action={
            <Link
              to={href('/shop')}
              className="rounded-full bg-neon px-7 py-3 font-grotesk text-[14px] uppercase text-ink"
            >
              Browse the collection
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:px-10">
      <Seo
        title="Checkout"
        description={'Complete your order in ' + config.country + '.'}
        path="/checkout"
        noindex
      />
      <div className="mb-10">
        <h1 className="font-grotesk text-[34px] uppercase leading-none text-ink sm:text-[44px]">
          Checkout
        </h1>
        <p className="mt-3 inline-flex items-center gap-2 font-body text-[14px] uppercase text-muted">
          <Flag code={config.code} className="h-3 w-[18px]" />
          <span>
            {config.country} store · paying in {config.currency.code}
          </span>
        </p>
      </div>

      <form
        onSubmit={submit}
        noValidate
        className="grid grid-cols-1 gap-10 lg:grid-cols-[1.5fr_1fr] lg:gap-14"
      >
        <div className="space-y-10">
          {/* ------------------------------------------------ contact */}
          <section>
            <Legend step={1} title="Contact" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Full name"
                value={form.fullName}
                onChange={(v) => update('fullName', v)}
                error={errors.fullName}
                autoComplete="name"
              />
              <Field
                label="Email"
                type="email"
                value={form.email}
                onChange={(v) => update('email', v)}
                error={errors.email}
                autoComplete="email"
                hint="Your receipt and tracking go here."
              />
              <div className="sm:col-span-2">
                <Field
                  label="Phone"
                  value={form.phone}
                  onChange={(v) => update('phone', v)}
                  error={errors.phone}
                  autoComplete="tel"
                  prefix={config.address.phonePrefix}
                  placeholder={config.address.phonePlaceholder}
                  hint="The courier will call or message this number."
                />
              </div>
            </div>
          </section>

          {/* ------------------------------------------------ address */}
          <section>
            <Legend step={2} title="Delivery address" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field
                  label="Address"
                  value={form.line1}
                  onChange={(v) => update('line1', v)}
                  error={errors.line1}
                  autoComplete="address-line1"
                  placeholder="Street address, building"
                />
              </div>
              <div className="sm:col-span-2">
                <Field
                  label="Apartment, floor, landmark (optional)"
                  value={form.line2}
                  onChange={(v) => update('line2', v)}
                  autoComplete="address-line2"
                />
              </div>
              <Field
                label="City"
                value={form.city}
                onChange={(v) => update('city', v)}
                error={errors.city}
                autoComplete="address-level2"
              />
              <SelectField
                label={config.address.regionLabel}
                value={form.region}
                onChange={(v) => update('region', v)}
                error={errors.region}
                options={config.address.regionOptions}
                placeholder={`Select ${config.address.regionLabel.toLowerCase()}`}
              />
              <Field
                label={config.address.postalLabel}
                value={form.postalCode}
                onChange={(v) => update('postalCode', v)}
                error={errors.postalCode}
                autoComplete="postal-code"
                placeholder={config.address.postalPlaceholder}
              />
              <div className="flex items-end">
                <div className="w-full rounded-[12px] border border-ink/10 bg-ink/[0.02] px-3 py-2.5 font-body text-[14px] text-muted">
                  Country · {config.country}
                </div>
              </div>
            </div>
            {config.code === 'us' && form.region && (
              <p className="mt-3 font-body text-[12px] uppercase text-muted">
                Sales tax for {form.region} is applied to this order.
              </p>
            )}
          </section>

          {/* ----------------------------------------------- delivery */}
          <section>
            <Legend step={3} title="Delivery" />
            <div className="space-y-2.5">
              {(quote.data?.shippingOptions ?? []).map((option) => (
                <label
                  key={option.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-[14px] border p-4 transition-colors ${
                    shippingId === option.id
                      ? 'border-accent/50 bg-accent/[0.06]'
                      : 'border-ink/12 hover:border-ink/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="shipping"
                    checked={shippingId === option.id}
                    onChange={() => setShippingId(option.id)}
                    className="h-3.5 w-3.5 accent-[#2F7D00]"
                  />
                  <span className="flex-1">
                    <span className="block font-grotesk text-[14px] uppercase text-ink">
                      {option.label}
                    </span>
                    <span className="block font-body text-[13px] text-muted">{option.eta}</span>
                  </span>
                  <span className="font-body text-[14px] text-accent">
                    {option.amount === 0 ? 'Free' : formatMoney(option.amount, config, false)}
                  </span>
                </label>
              ))}
              {!quote.data && <div className="h-40 animate-pulse rounded-[14px] bg-ink/5" />}
            </div>
          </section>

          {/* ------------------------------------------------ payment */}
          <section>
            <Legend step={4} title="Payment" />
            <div className="space-y-2.5">
              {config.paymentMethods.map((method) => (
                <label
                  key={method.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-[14px] border p-4 transition-colors ${
                    paymentId === method.id
                      ? 'border-accent/50 bg-accent/[0.06]'
                      : 'border-ink/12 hover:border-ink/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentId === method.id}
                    onChange={() => setPaymentId(method.id)}
                    className="h-3.5 w-3.5 accent-[#2F7D00]"
                  />
                  <span className="flex-1">
                    <span className="block font-grotesk text-[14px] uppercase text-ink">
                      {method.label}
                    </span>
                    <span className="block font-body text-[13px] text-muted">{method.description}</span>
                  </span>
                  {method.surcharge ? (
                    <span className="font-body text-[13px] text-amber-300">
                      + {formatMoney(method.surcharge, config, false)}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>

            <div className="mt-4 flex gap-2.5 rounded-[14px] border border-ink/12 bg-ink/[0.02] p-4">
              <Lock size={14} className="mt-0.5 flex-none text-muted" />
              <p className="font-body text-[12px] leading-relaxed text-muted">
                {selectedPayment.offline ? (
                  <>
                    No payment is taken now — you pay on delivery. We will confirm the order by email
                    and the courier collects {quote.data ? formatMoney(quote.data.totals.total, config, false) : 'the total'} at
                    the door.
                  </>
                ) : (
                  <>
                    Card details are never handled by this page. In production the order is created
                    server-side and the payment is completed on the provider&apos;s own hosted form —
                    Stripe, Checkout.com, Easypaisa or JazzCash depending on the store.{' '}
                    <strong className="text-ink/80">
                      This build records the order without charging a card.
                    </strong>
                  </>
                )}
              </p>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------- summary */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-[20px] border border-ink/10 bg-ink/[0.02] p-6">
            <h2 className="mb-5 font-grotesk text-[14px] uppercase text-ink">Your order</h2>

            <ul className="mb-5 space-y-3">
              {resolved.map(({ line, product, variant, lineTotal }) => (
                <li key={variant.id} className="flex items-center gap-3">
                  <div className="relative h-14 w-14 flex-none overflow-hidden rounded-[10px] bg-surface">
                    <Media item={product.media[0]} autoPlay={false} />
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink/90 px-1 font-body text-[12px] font-bold text-ink">
                      {line.quantity}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-grotesk text-[13px] uppercase text-ink">
                      {product.name}
                    </div>
                    <div className="truncate font-body text-[12px] text-muted">{variant.label}</div>
                  </div>
                  <div className="flex-none font-body text-[14px] text-ink">
                    {formatMoney(lineTotal, config, false)}
                  </div>
                </li>
              ))}
            </ul>

            <div className="mb-5">
              <PromoField
                code={promo.code}
                appliedLabel={promo.label}
                error={promo.error}
                onApply={promo.apply}
                onClear={promo.clear}
                busy={promo.busy}
              />
            </div>

            {quote.data ? (
              <TotalsRows totals={quote.data.totals} />
            ) : (
              <div className="h-36 animate-pulse rounded bg-ink/5" />
            )}

            {submitError && (
              <div className="mt-4 flex gap-2 rounded-[12px] border border-red-400/30 bg-red-500/10 p-3">
                <AlertCircle size={14} className="mt-0.5 flex-none text-red-300" />
                <p className="font-body text-[13px] leading-relaxed text-red-200">{submitError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !quote.data}
              className="press mt-6 w-full rounded-full bg-neon py-3.5 font-grotesk text-[15px] uppercase text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {submitting
                ? 'Placing order…'
                : selectedPayment.offline
                  ? 'Place order'
                  : `Pay ${quote.data ? formatMoney(quote.data.totals.total, config, false) : ''}`}
            </button>

            <p className="mt-3 text-center font-body text-[12px] leading-relaxed text-muted">
              By placing this order you agree to our terms. {config.policy.returnsDays}-day returns ·{' '}
              {config.taxNote}
            </p>
          </div>
        </aside>
      </form>
    </div>
  )
}

function newIdempotencyKey(): string {
  // randomUUID needs a secure context; the fallback is only ever hit on
  // plain-http origins, where a timestamp plus randomness is plenty.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// -------------------------------------------------------------- fields

function Legend({ step, title }: { step: number; title: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-ink/20 font-body text-[13px] text-ink/80">
        {step}
      </span>
      <h2 className="font-grotesk text-[15px] uppercase text-ink">{title}</h2>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  error,
  type = 'text',
  autoComplete,
  placeholder,
  prefix,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  type?: string
  autoComplete?: string
  placeholder?: string
  prefix?: string
  hint?: string
}) {
  return (
    <label className="block" data-error={Boolean(error)}>
      <span className="mb-1.5 block font-body text-[12px] uppercase tracking-wide text-muted">
        {label}
      </span>
      <span
        className={`flex items-center rounded-[12px] border bg-ink/5 transition-colors focus-within:border-ink/45 ${
          error ? 'border-red-400/60' : 'border-ink/15'
        }`}
      >
        {prefix && (
          <span className="pl-3 font-body text-[14px] text-muted">{prefix}</span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className="w-full bg-transparent px-3 py-2.5 font-body text-[14px] text-ink outline-none placeholder:text-muted"
        />
      </span>
      {error ? (
        <span className="mt-1.5 block font-body text-[12px] text-red-300">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block font-body text-[12px] text-muted">{hint}</span>
      ) : null}
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  error?: string
  placeholder: string
}) {
  return (
    <label className="block" data-error={Boolean(error)}>
      <span className="mb-1.5 block font-body text-[12px] uppercase tracking-wide text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-[12px] border bg-ink/5 px-3 py-2.5 font-body text-[14px] text-ink outline-none transition-colors focus:border-ink/45 ${
          error ? 'border-red-400/60' : 'border-ink/15'
        }`}
      >
        <option value="" className="bg-background">
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option} value={option} className="bg-background">
            {option}
          </option>
        ))}
      </select>
      {error && <span className="mt-1.5 block font-body text-[12px] text-red-300">{error}</span>}
    </label>
  )
}
