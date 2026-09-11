import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { REGION_LIST } from '../regions/config'
import { useRegion } from '../regions/RegionContext'

/**
 * Moves the visitor between the three storefronts. Everything downstream
 * — currency, tax, shipping, payment methods, stock — follows from this
 * one choice, so it stays visible in the header rather than buried in a
 * footer the way most stores hide it.
 */
export default function RegionSwitcher({ compact = false }: { compact?: boolean }) {
  const { region, config, setRegion } = useRegion()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 font-mono text-[11px] uppercase text-cream transition-colors hover:border-white/30"
      >
        {/* Windows has no country-flag glyphs and falls back to the
            letters "AE"/"PK" — which is exactly the country code, so
            showing both would read as a stutter. Show one. */}
        <span aria-hidden="true" className="text-[14px] leading-none">
          {config.flag}
        </span>
        <span className="text-cream/50">{config.currency.code}</span>
        <span className="sr-only">Change store. Currently {config.country}.</span>
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="animate-scale-in absolute right-0 z-50 mt-2 w-[268px] origin-top-right overflow-hidden rounded-[16px] border border-white/15 bg-[#060d2e] shadow-2xl shadow-black/60"
        >
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-cream/45">
            <Globe size={12} />
            Choose your store
          </div>
          {REGION_LIST.map((r) => {
            const active = r.code === region
            return (
              <button
                key={r.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setRegion(r.code)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                  active ? 'bg-white/[0.07]' : 'hover:bg-white/5'
                }`}
              >
                <span aria-hidden="true" className="text-[18px] leading-none">
                  {r.flag}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-grotesk text-[12px] uppercase text-cream">
                    {r.country}
                  </span>
                  <span className="block font-mono text-[10px] uppercase text-cream/50">
                    Prices in {r.currency.code} · {r.taxLabel}
                  </span>
                </span>
                {active && <Check size={15} className="flex-none text-neon" />}
              </button>
            )
          })}
          <p className="border-t border-white/10 px-4 py-3 font-mono text-[10px] leading-relaxed text-cream/40">
            Each store has its own prices, delivery options and payment methods. Your basket stays with
            the store you built it in.
          </p>
        </div>
      )}
    </div>
  )
}
