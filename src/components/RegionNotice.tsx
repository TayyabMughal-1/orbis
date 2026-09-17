import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { REGIONS, type RegionCode } from '../regions/config'
import { detectRegionAsync } from '../regions/detect'
import { useRegion } from '../regions/RegionContext'
import { STORAGE_KEYS, readString, writeString } from '../lib/storage'
import Flag from './ui/Flag'

const DISMISS_KEY = 'orbis.regionNotice.dismissed.v1'

/**
 * Shown when a visitor is browsing one storefront but appears to be in
 * another market — a shared /us link opened in Karachi, say.
 *
 * It suggests; it never redirects. Nobody enjoys being bounced to a
 * different site mid-click, and a visitor may be buying a gift for
 * somewhere else entirely. Once they choose, or dismiss, we stop asking.
 */
export default function RegionNotice() {
  const { region, setRegion } = useRegion()
  const [suggested, setSuggested] = useState<RegionCode | null>(null)

  useEffect(() => {
    let alive = true

    // An explicit choice, or a previous dismissal, ends the conversation.
    if (readString(STORAGE_KEYS.region) || readString(DISMISS_KEY)) return

    detectRegionAsync().then((detected) => {
      if (alive && detected !== region) setSuggested(detected)
    })

    return () => {
      alive = false
    }
  }, [region])

  if (!suggested) return null
  const target = REGIONS[suggested]
  const current = REGIONS[region]

  function dismiss() {
    writeString(DISMISS_KEY, '1')
    setSuggested(null)
  }

  return (
    <div className="animate-fade-in relative z-[60] border-b border-ink/10 bg-ink/[0.04]">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6 lg:px-10">
        <Flag code={target.code} className="h-4 w-6" />
        <p className="font-mono text-[11px] leading-relaxed text-ink/80">
          You are shopping the {current.country} store in {current.currency.code}. Prices, delivery and
          payment methods are different in {target.country}.
        </p>
        <button
          type="button"
          onClick={() => {
            setRegion(suggested)
            setSuggested(null)
          }}
          className="press rounded-full bg-neon px-4 py-1.5 font-grotesk text-[11px] uppercase text-ink"
        >
          Switch to {target.currency.code}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-muted hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
