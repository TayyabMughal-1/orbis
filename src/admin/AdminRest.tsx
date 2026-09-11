import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { adminApi, type AdminPromo, type RegionSettings, type ShippingSetting } from '../api/admin'
import { errorMessage } from '../api/client'
import { REGIONS, REGION_CODES, type RegionCode } from '../regions/config'
import { formatMoney, minorPerMajor } from '../lib/money'
import { AdminButton, AdminHeading, Banner, Field, inputClass } from './AdminShell'
import type { Order } from '../types'

// ---------------------------------------------------------------------
// Promo codes, orders and per-store settings.
//
// Grouped in one file because each is a single screen of forms; splitting
// them would be three files of imports and one screen of substance each.
// ---------------------------------------------------------------------

const majorToMinor = (value: string, region: RegionCode) => {
  const parsed = Number(String(value).replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? Math.round(parsed * minorPerMajor(REGIONS[region])) : 0
}

const minorToMajor = (value: number, region: RegionCode) =>
  (value / minorPerMajor(REGIONS[region])).toFixed(REGIONS[region].currency.decimals)

// ------------------------------------------------------------- promos

const blankPromo = (): AdminPromo => ({
  code: '',
  label: '',
  percentOff: 10,
  regions: ['us', 'ae', 'pk'],
  minSubtotal: { us: 0, ae: 0, pk: 0 },
  active: true,
})

export function AdminPromos() {
  const [promos, setPromos] = useState<AdminPromo[] | null>(null)
  const [draft, setDraft] = useState<AdminPromo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(() => {
    adminApi.listPromos().then(setPromos).catch((err) => setError(errorMessage(err)))
  }, [])
  useEffect(load, [load])

  async function save() {
    if (!draft) return
    setError(null)
    try {
      await adminApi.savePromo(draft)
      setSaved(`${draft.code.toUpperCase()} saved and live.`)
      setDraft(null)
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function remove(code: string) {
    if (!window.confirm(`Delete ${code}? Anyone with the code will stop being able to use it.`)) return
    try {
      await adminApi.deletePromo(code)
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <AdminHeading
        title="Promo codes"
        subtitle="Discounts are checked again on the server at checkout, so a code cannot be forced from the browser."
        action={
          <AdminButton onClick={() => setDraft(blankPromo())}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} /> New code
            </span>
          </AdminButton>
        }
      />

      {error && <Banner tone="error">{error}</Banner>}
      {saved && <Banner tone="ok">{saved}</Banner>}

      {draft && (
        <div className="mb-8 rounded-[14px] border border-neon/25 bg-neon/[0.04] p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Code" hint="Letters and digits. Saved upper-case.">
              <input
                className={inputClass}
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Description" hint="Shown to the customer when it applies.">
              <input
                className={inputClass}
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </Field>
            <Field label="Discount %" hint="1–90.">
              <input
                className={inputClass}
                value={String(draft.percentOff)}
                onChange={(e) => setDraft({ ...draft, percentOff: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Active">
              <select
                className={inputClass}
                value={draft.active ? 'yes' : 'no'}
                onChange={(e) => setDraft({ ...draft, active: e.target.value === 'yes' })}
              >
                <option value="yes" className="bg-[#060d2e]">Live</option>
                <option value="no" className="bg-[#060d2e]">Paused</option>
              </select>
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {REGION_CODES.map((region) => {
              const on = draft.regions.includes(region)
              return (
                <div key={region} className="rounded-[10px] border border-white/10 p-3">
                  <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] uppercase text-cream/70">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          regions: e.target.checked
                            ? [...draft.regions, region]
                            : draft.regions.filter((r) => r !== region),
                        })
                      }
                      className="h-3.5 w-3.5 accent-[#6FFF00]"
                    />
                    {REGIONS[region].country}
                  </label>
                  <div className="mt-2">
                    <Field label={`Minimum spend (${REGIONS[region].currency.code})`}>
                      <input
                        className={inputClass}
                        disabled={!on}
                        value={minorToMajor(draft.minSubtotal[region] ?? 0, region)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            minSubtotal: {
                              ...draft.minSubtotal,
                              [region]: majorToMinor(e.target.value, region),
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex gap-2">
            <AdminButton onClick={save} disabled={!draft.code || !draft.label}>
              Save code
            </AdminButton>
            <AdminButton tone="ghost" onClick={() => setDraft(null)}>
              Cancel
            </AdminButton>
          </div>
        </div>
      )}

      {promos && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-left font-mono text-[10px] uppercase tracking-wide text-cream/40">
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Discount</th>
                <th className="py-2 pr-4">Stores</th>
                <th className="py-2 pr-4">Minimum spend</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {promos.map((promo) => (
                <tr key={promo.code} className="border-b border-white/5">
                  <td className="py-3 pr-4">
                    <button
                      type="button"
                      onClick={() => setDraft(promo)}
                      className="font-grotesk text-[13px] uppercase text-cream hover:text-neon"
                    >
                      {promo.code}
                    </button>
                    <div className="mt-0.5 font-mono text-[10px] text-cream/35">{promo.label}</div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-[12px] text-neon">{promo.percentOff}%</td>
                  <td className="py-3 pr-4 font-mono text-[11px] uppercase text-cream/60">
                    {promo.regions.join(', ')}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[11px] text-cream/60">
                    {promo.regions
                      .map((r) =>
                        promo.minSubtotal[r]
                          ? formatMoney(promo.minSubtotal[r], REGIONS[r], true)
                          : '—',
                      )
                      .join(' / ')}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[11px]">
                    <span className={promo.active ? 'text-neon' : 'text-cream/35'}>
                      {promo.active ? 'Live' : 'Paused'}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => remove(promo.code)}
                      aria-label={`Delete ${promo.code}`}
                      className="text-cream/30 transition-colors hover:text-red-300"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {promos.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 font-mono text-[11px] text-cream/35">
                    No promo codes yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ------------------------------------------------------------- orders

export function AdminOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    adminApi.listOrders().then(setOrders).catch((err) => setError(errorMessage(err)))
  }, [])
  useEffect(load, [load])

  async function move(order: Order, patch: { status?: string; paymentStatus?: string }) {
    try {
      const updated = await adminApi.updateOrder(order.number, patch)
      setOrders((list) => (list ?? []).map((o) => (o.number === updated.number ? updated : o)))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <AdminHeading
        title="Orders"
        subtitle={orders ? `${orders.length} most recent, newest first` : undefined}
      />
      {error && <Banner tone="error">{error}</Banner>}

      {orders && (
        <div className="space-y-3">
          {orders.map((order) => {
            const config = REGIONS[order.region]
            return (
              <div key={order.number} className="rounded-[14px] border border-white/10 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-grotesk text-[14px] uppercase text-cream">{order.number}</div>
                    <div className="mt-1 font-mono text-[11px] text-cream/50">
                      {new Date(order.placedAt).toLocaleString(config.locale)} · {order.address.fullName} ·{' '}
                      {order.email}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-cream/40">
                      {order.address.city}, {order.address.region}, {config.country} · {order.shipping.label}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[15px] text-neon">
                      {formatMoney(order.totals.total, config, false)}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase text-cream/40">
                      {order.paymentMethodLabel}
                    </div>
                  </div>
                </div>

                <ul className="mt-3 border-t border-white/10 pt-3">
                  {order.lines.map((line) => (
                    <li key={line.sku} className="flex justify-between font-mono text-[11px] text-cream/60">
                      <span>
                        {line.quantity} × {line.productName}{' '}
                        <span className="text-cream/35">({line.variantLabel})</span>
                      </span>
                      <span>{formatMoney(line.lineTotal, config, false)}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex flex-wrap gap-3">
                  <Field label="Fulfilment">
                    <select
                      className={inputClass}
                      value={order.status}
                      onChange={(e) => move(order, { status: e.target.value })}
                    >
                      {['confirmed', 'processing', 'shipped'].map((s) => (
                        <option key={s} value={s} className="bg-[#060d2e]">
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Payment">
                    <select
                      className={inputClass}
                      value={order.paymentStatus}
                      onChange={(e) => move(order, { paymentStatus: e.target.value })}
                    >
                      {['pending', 'paid', 'due_on_delivery'].map((s) => (
                        <option key={s} value={s} className="bg-[#060d2e]">
                          {s.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            )
          })}
          {orders.length === 0 && (
            <p className="font-mono text-[12px] text-cream/40">No orders yet.</p>
          )}
        </div>
      )}
    </>
  )
}

// ----------------------------------------------------------- settings

export function AdminSettings() {
  const [region, setRegion] = useState<RegionCode>('us')
  const [settings, setSettings] = useState<RegionSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const base = REGIONS[region]

  useEffect(() => {
    setSettings(null)
    setSaved(false)
    adminApi
      .getSettings(region)
      .then((loaded) =>
        setSettings({
          ...loaded,
          shipping:
            loaded.shipping ??
            base.shipping.map((t) => ({
              id: t.id,
              label: t.label,
              eta: t.eta,
              amount: t.amount,
              freeOver: t.freeOver ?? null,
            })),
        }),
      )
      .catch((err) => setError(errorMessage(err)))
  }, [region, base])

  async function save() {
    if (!settings) return
    setError(null)
    try {
      await adminApi.putSettings(region, settings)
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const patch = (key: keyof RegionSettings) => (value: unknown) => {
    setSettings((s) => ({ ...(s ?? {}), [key]: value }))
    setSaved(false)
  }

  const setTier = (index: number, key: keyof ShippingSetting, value: unknown) => {
    setSettings((s) => {
      const shipping = [...(s?.shipping ?? [])]
      shipping[index] = { ...shipping[index], [key]: value }
      return { ...(s ?? {}), shipping }
    })
    setSaved(false)
  }

  return (
    <>
      <AdminHeading
        title="Store settings"
        subtitle="Copy, delivery prices and tax, per store. Anything left blank keeps the built-in default."
        action={
          <AdminButton onClick={save} disabled={!settings}>
            Save {base.countryCode}
          </AdminButton>
        }
      />

      <div className="mb-6 flex gap-2">
        {REGION_CODES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRegion(r)}
            className={`rounded-full border px-4 py-2 font-mono text-[11px] uppercase transition-colors ${
              r === region
                ? 'border-neon/50 bg-neon/10 text-neon'
                : 'border-white/15 text-cream/55 hover:border-white/35'
            }`}
          >
            {REGIONS[r].country}
          </button>
        ))}
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {saved && <Banner tone="ok">Saved. The storefront picks this up on its next load.</Banner>}

      {settings && (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Field label="Promo strip" hint={`Default: "${base.hero.promo}"`}>
              <input
                className={inputClass}
                value={settings.promoStrip ?? ''}
                placeholder={base.hero.promo}
                onChange={(e) => patch('promoStrip')(e.target.value)}
              />
            </Field>
            <Field label="Hero eyebrow" hint={`Default: "${base.hero.eyebrow}"`}>
              <input
                className={inputClass}
                value={settings.heroEyebrow ?? ''}
                placeholder={base.hero.eyebrow}
                onChange={(e) => patch('heroEyebrow')(e.target.value)}
              />
            </Field>
            <Field label="Support email" hint={`Default: ${base.support.email}`}>
              <input
                className={inputClass}
                value={settings.supportEmail ?? ''}
                placeholder={base.support.email}
                onChange={(e) => patch('supportEmail')(e.target.value)}
              />
            </Field>
            <Field label="Support phone" hint={`Default: ${base.support.phone}`}>
              <input
                className={inputClass}
                value={settings.supportPhone ?? ''}
                placeholder={base.support.phone}
                onChange={(e) => patch('supportPhone')(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-6">
            <Field
              label={`${base.taxLabel} rate`}
              hint={`As a decimal — 0.18 is 18%. Default ${base.taxRate}. This changes what customers are actually charged.`}
            >
              <input
                className={inputClass}
                value={settings.taxRate ?? ''}
                placeholder={String(base.taxRate)}
                onChange={(e) =>
                  patch('taxRate')(e.target.value === '' ? undefined : Number(e.target.value))
                }
              />
            </Field>
          </div>

          <h2 className="mb-3 mt-10 font-grotesk text-[15px] uppercase text-cream">
            Delivery options — {base.country}
          </h2>
          <div className="space-y-3">
            {(settings.shipping ?? []).map((tier, index) => (
              <div key={tier.id} className="rounded-[12px] border border-white/10 bg-white/[0.02] p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <Field label="Name">
                    <input
                      className={inputClass}
                      value={tier.label}
                      onChange={(e) => setTier(index, 'label', e.target.value)}
                    />
                  </Field>
                  <Field label="Timing">
                    <input
                      className={inputClass}
                      value={tier.eta}
                      onChange={(e) => setTier(index, 'eta', e.target.value)}
                    />
                  </Field>
                  <Field label={`Price (${base.currency.code})`}>
                    <input
                      className={inputClass}
                      value={minorToMajor(tier.amount, region)}
                      onChange={(e) => setTier(index, 'amount', majorToMinor(e.target.value, region))}
                    />
                  </Field>
                  <Field label="Free over" hint="Blank for never.">
                    <input
                      className={inputClass}
                      value={tier.freeOver == null ? '' : minorToMajor(tier.freeOver, region)}
                      onChange={(e) =>
                        setTier(
                          index,
                          'freeOver',
                          e.target.value === '' ? null : majorToMinor(e.target.value, region),
                        )
                      }
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 border-t border-white/10 pt-5">
            <AdminButton onClick={save}>Save {base.countryCode} settings</AdminButton>
          </div>
        </>
      )}
    </>
  )
}
