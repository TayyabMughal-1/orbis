import { useState, type FormEvent } from 'react'
import { Tag, X } from 'lucide-react'
import { useRegion } from '../regions/RegionContext'
import { formatMoney, formatPercent } from '../lib/money'
import type { OrderTotals } from '../types'

/**
 * The totals block, shared by the cart, the checkout and the order
 * confirmation so all three can never disagree. Which rows appear is
 * itself regional: the US adds tax on top, the UAE and Pakistan show
 * what was already included.
 */
export function TotalsRows({ totals, shippingPending }: { totals: OrderTotals; shippingPending?: boolean }) {
  const { config } = useRegion()
  const money = (n: number) => formatMoney(n, config, false)

  return (
    <dl className="space-y-2.5 font-body text-[12px]">
      <Row label="Subtotal" value={money(totals.subtotal)} />

      {totals.discount > 0 && (
        <Row label="Discount" value={`− ${money(totals.discount)}`} accent />
      )}

      <Row
        label="Delivery"
        value={
          shippingPending
            ? 'Calculated at checkout'
            : totals.shipping === 0
              ? 'Free'
              : money(totals.shipping)
        }
        accent={!shippingPending && totals.shipping === 0}
      />

      {totals.surcharge > 0 && <Row label="Payment handling" value={money(totals.surcharge)} />}

      {totals.tax > 0 && (
        <Row
          label={`${totals.taxLabel} (${formatPercent(totals.taxRate, config.locale)})`}
          value={money(totals.tax)}
        />
      )}

      <div className="border-t border-ink/10 pt-3">
        <div className="flex items-center justify-between font-grotesk text-[15px] uppercase text-ink">
          <dt>Total</dt>
          <dd className="text-accent">{money(totals.total)}</dd>
        </div>
        {totals.taxIncluded > 0 && (
          <p className="mt-1.5 text-right font-body text-[10px] uppercase text-muted">
            Includes {money(totals.taxIncluded)} {totals.taxLabel} at{' '}
            {formatPercent(totals.taxRate, config.locale)}
          </p>
        )}
      </div>
    </dl>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={accent ? 'text-accent' : 'text-ink'}>{value}</dd>
    </div>
  )
}

export function PromoField({
  code,
  appliedLabel,
  error,
  onApply,
  onClear,
  busy,
}: {
  code: string | null
  appliedLabel: string | null
  error: string | null
  onApply: (code: string) => void
  onClear: () => void
  busy?: boolean
}) {
  const [draft, setDraft] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = draft.trim()
    if (value) onApply(value)
  }

  if (code && appliedLabel) {
    return (
      <div className="flex items-center gap-2 rounded-[12px] border border-accent/35 bg-accent/[0.07] px-3 py-2.5">
        <Tag size={13} className="flex-none text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-body text-[11px] uppercase text-accent">{code}</div>
          <div className="truncate font-body text-[10px] text-muted">{appliedLabel}</div>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Remove promo code"
          className="flex-none text-muted hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          placeholder="Promo code"
          className="min-w-0 flex-1 rounded-[12px] border border-ink/15 bg-ink/5 px-3 py-2.5 font-body text-[12px] uppercase text-ink outline-none placeholder:text-muted focus:border-ink/40"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="flex-none rounded-[12px] border border-ink/20 px-4 py-2.5 font-body text-[11px] uppercase text-ink transition-colors hover:border-ink/45 disabled:opacity-35"
        >
          {busy ? '…' : 'Apply'}
        </button>
      </div>
      {error && <p className="mt-2 font-body text-[10px] text-amber-300">{error}</p>}
    </form>
  )
}
