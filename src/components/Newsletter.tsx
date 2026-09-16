import { useState, type FormEvent } from 'react'
import { Check, Mail } from 'lucide-react'
import { useRegion } from '../regions/RegionContext'

/**
 * Newsletter sign-up.
 *
 * There is no mailing-list provider wired in, and pretending otherwise
 * would be worse than useless — someone would type their address and
 * hear nothing forever. So this validates the address, says plainly that
 * it is not connected yet, and points at where the integration goes.
 * Swap `subscribe()` for a call to Klaviyo, Mailchimp or your own
 * endpoint and the rest of the component is finished.
 */
async function subscribe(email: string): Promise<'ok' | 'unconfigured'> {
  // POST /api/newsletter { email } — see server/src for where this lands.
  void email
  return 'unconfigured'
}

export default function Newsletter() {
  const { config } = useRegion()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const value = email.trim()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setState('error')
      setMessage('That email address does not look right.')
      return
    }

    setState('busy')
    const result = await subscribe(value)
    setState('done')
    setMessage(
      result === 'unconfigured'
        ? 'Thanks — note that no mailing list is connected to this build yet, so nothing was actually sent.'
        : `You are on the list. Look out for a code in your inbox.`,
    )
  }

  if (state === 'done') {
    return (
      <div className="flex items-start gap-2.5 rounded-[14px] border border-accent/30 bg-accent/[0.06] p-4">
        <Check size={15} className="mt-0.5 flex-none text-accent" strokeWidth={2.5} />
        <p className="font-mono text-[11px] leading-relaxed text-ink/80">{message}</p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="newsletter" className="block font-grotesk text-[12px] uppercase text-ink">
        10% off your first order
      </label>
      <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted">
        New drops, restocks and the odd discount. One email a month at most, and you can leave
        whenever you like.
      </p>

      <div className="mt-3 flex gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-ink/15 bg-ink/5 px-3">
          <Mail size={14} className="flex-none text-muted" />
          <input
            id="newsletter"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (state === 'error') setState('idle')
            }}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full bg-transparent py-2.5 font-mono text-[12px] text-ink outline-none placeholder:text-muted"
          />
        </div>
        <button
          type="submit"
          disabled={state === 'busy'}
          className="press flex-none rounded-full bg-neon px-5 py-2.5 font-grotesk text-[11px] uppercase text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {state === 'busy' ? '…' : 'Join'}
        </button>
      </div>

      {state === 'error' && message && (
        <p className="mt-2 font-mono text-[10px] text-amber-300">{message}</p>
      )}
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted">
        By joining you agree to hear from {config.entity.name}. Unsubscribe in one click.
      </p>
    </form>
  )
}
