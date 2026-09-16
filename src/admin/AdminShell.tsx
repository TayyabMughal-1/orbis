import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { AtSign, LayoutGrid, Lock, LogOut, Package, Percent, Settings, ShoppingBag } from 'lucide-react'
import { adminApi, apiReachable, getToken, isLocalhost } from '../api/admin'
import { errorMessage } from '../api/client'

// ---------------------------------------------------------------------
// The dashboard shell: login gate, navigation, and the signed-in frame.
//
// Deliberately plainer than the storefront. This is a tool for one
// person doing careful work with prices and stock — legibility and
// obvious affordances matter far more than atmosphere.
// ---------------------------------------------------------------------

export default function AdminShell() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()))

  // A token can expire while a tab sits open; any 401 clears it, and
  // this picks that up so the UI falls back to the login screen instead
  // of showing empty tables.
  const recheck = useCallback(() => setAuthed(Boolean(getToken())), [])
  useEffect(() => {
    const id = setInterval(recheck, 30_000)
    window.addEventListener('focus', recheck)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', recheck)
    }
  }, [recheck])

  if (!authed) return <Login onSignedIn={() => setAuthed(true)} />
  return <Dashboard onSignOut={() => setAuthed(false)} />
}

// --------------------------------------------------------------- login

function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiDown, setApiDown] = useState(false)

  // Check before anyone types. A dashboard that rejects a correct
  // password because nothing is listening is a miserable ten minutes.
  useEffect(() => {
    let alive = true
    apiReachable().then((ok) => {
      if (alive) setApiDown(!ok)
    })
    return () => {
      alive = false
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await adminApi.login(email, password)
      onSignedIn()
    } catch (err) {
      setError(errorMessage(err))
      // Keep the email — retyping it after a typo in the password is
      // pure friction, and it is not the half worth clearing.
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} noValidate className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-grotesk text-[22px] uppercase text-ink">
            Orbis <span className="text-muted">Store</span>
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Dashboard
          </div>
        </div>

        <label
          htmlFor="admin-email"
          className="mb-2 block font-mono text-[10px] uppercase tracking-wide text-muted"
        >
          Email
        </label>
        <div className="mb-4 flex items-center gap-2 rounded-[12px] border border-ink/15 bg-ink/5 px-3 focus-within:border-ink/40">
          <AtSign size={14} className="flex-none text-muted" />
          <input
            id="admin-email"
            type="email"
            autoFocus
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            className="w-full bg-transparent py-3 font-mono text-[13px] text-ink outline-none"
          />
        </div>

        <label
          htmlFor="admin-password"
          className="mb-2 block font-mono text-[10px] uppercase tracking-wide text-muted"
        >
          Password
        </label>
        <div className="flex items-center gap-2 rounded-[12px] border border-ink/15 bg-ink/5 px-3 focus-within:border-ink/40">
          <Lock size={14} className="flex-none text-muted" />
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            className="w-full bg-transparent py-3 font-mono text-[13px] text-ink outline-none"
          />
        </div>

        {apiDown && (
          <p className="mt-3 rounded-[10px] border border-amber-400/35 bg-amber-400/10 p-3 font-mono text-[11px] leading-relaxed text-amber-100">
            {isLocalhost ? (
              <>
                The API is not running, so signing in cannot work yet. Start it with{' '}
                <code className="text-amber-200">npm run dev:all</code> (or{' '}
                <code className="text-amber-200">npm run api</code> in a second terminal), then
                reload this page.
              </>
            ) : (
              <>
                This deployment has no API behind it, so the dashboard cannot work here. The
                storefront runs on its built-in catalogue, but products, orders and settings need
                the backend hosted somewhere with a database — then set{' '}
                <code className="text-amber-200">VITE_API_URL</code> to its address and rebuild. The
                README covers both options.
              </>
            )}
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-[10px] border border-red-400/30 bg-red-500/10 p-3 font-mono text-[11px] leading-relaxed text-red-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="press mt-5 w-full rounded-full bg-neon py-3 font-grotesk text-[13px] uppercase text-ink disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>

        <p className="mt-5 font-mono text-[10px] leading-relaxed text-muted">
          Set <code className="text-muted">ADMIN_PASSWORD</code> (or{' '}
          <code className="text-muted">ADMIN_PASSWORD_HASH</code>) on the API to enable this. With
          neither set, the dashboard stays locked.
        </p>
      </form>
    </div>
  )
}

// ----------------------------------------------------------- dashboard

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const navigate = useNavigate()

  function signOut() {
    adminApi.logout()
    onSignOut()
    navigate('/admin')
  }

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 font-mono text-[12px] transition-colors ${
      isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-ink/5 hover:text-ink'
    }`

  return (
    <div className="min-h-screen bg-background text-ink">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-10 lg:px-8">
        <aside className="lg:w-56 lg:flex-none">
          <div className="mb-6 font-grotesk text-[16px] uppercase text-ink">
            Orbis <span className="text-muted">Store</span>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              Dashboard
            </div>
          </div>

          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            <NavLink to="/admin" end className={link}>
              <Package size={15} /> Products
            </NavLink>
            <NavLink to="/admin/taxonomy" className={link}>
              <LayoutGrid size={15} /> Collections
            </NavLink>
            <NavLink to="/admin/promos" className={link}>
              <Percent size={15} /> Promo codes
            </NavLink>
            <NavLink to="/admin/orders" className={link}>
              <ShoppingBag size={15} /> Orders
            </NavLink>
            <NavLink to="/admin/settings" className={link}>
              <Settings size={15} /> Store settings
            </NavLink>
          </nav>

          <div className="mt-6 flex flex-col gap-2 border-t border-ink/10 pt-4">
            <a
              href="/"
              className="font-mono text-[11px] text-muted transition-colors hover:text-ink"
            >
              ← View the shop
            </a>
            <button
              type="button"
              onClick={signOut}
              className="flex items-center gap-2 font-mono text-[11px] text-muted transition-colors hover:text-ink"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-16">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

// -------------------------------------------------- shared admin bits

export function AdminHeading({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-ink/10 pb-4">
      <div>
        <h1 className="font-grotesk text-[24px] uppercase leading-none text-ink">{title}</h1>
        {subtitle && (
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  // The hint sits outside the <label> on purpose. Inside it, it becomes
  // part of the control's accessible name — a screen reader would
  // announce "Tagline The one line under the product name" as the field
  // name instead of "Tagline".
  return (
    <div className="block">
      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wide text-muted">
          {label}
        </span>
        {children}
      </label>
      {hint && <span className="mt-1 block font-mono text-[10px] text-muted">{hint}</span>}
    </div>
  )
}

export const inputClass =
  'w-full rounded-[10px] border border-ink/15 bg-ink/5 px-3 py-2.5 font-mono text-[12px] text-ink outline-none transition-colors focus:border-ink/40 placeholder:text-muted'

export function Banner({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  return (
    <div
      className={`mb-5 rounded-[12px] border p-3 font-mono text-[11px] leading-relaxed ${
        tone === 'ok'
          ? 'border-accent/35 bg-accent/[0.07] text-ink/80'
          : 'border-red-400/30 bg-red-500/10 text-red-200'
      }`}
    >
      {children}
    </div>
  )
}

export function AdminButton({
  children,
  onClick,
  type = 'button',
  tone = 'primary',
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  tone?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
}) {
  const tones = {
    primary: 'bg-neon text-ink hover:opacity-90',
    ghost: 'border border-ink/20 text-ink hover:border-ink/45',
    danger: 'border border-red-400/40 text-red-200 hover:bg-red-500/10',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`press rounded-full px-5 py-2.5 font-grotesk text-[12px] uppercase transition-colors disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  )
}
