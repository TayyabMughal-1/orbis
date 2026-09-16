import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Menu, Search, ShoppingBag, X } from 'lucide-react'
import { CATEGORIES } from '../api/db'
import { useCart } from '../context/CartContext'
import { useRegion } from '../regions/RegionContext'
import RegionSwitcher from './RegionSwitcher'

export default function Header() {
  const { config, href } = useRegion()
  const { count, open } = useCart()
  const navigate = useNavigate()

  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // A route change should always close the mobile sheet.
  useEffect(() => {
    if (!menuOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const term = query.trim()
    navigate(term ? `${href('/shop')}?q=${encodeURIComponent(term)}` : href('/shop'))
    setSearchOpen(false)
    setMenuOpen(false)
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `font-grotesk text-[12px] uppercase tracking-wide transition-colors ${
      isActive ? 'text-accent' : 'text-ink hover:text-accent'
    }`

  return (
    <>
      {/* Market-specific promo strip — the first thing that differs per store */}
      <div className="relative z-[70] bg-accent/90 px-4 py-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink">
        {config.hero.promo}
        <span className="hidden sm:inline">
          {' · '}
          {config.policy.returnsDays}-day returns · Ships from {config.country}
        </span>
      </div>

      <header
        className={`sticky top-0 z-[65] transition-colors ${
          scrolled ? 'border-b border-ink/10 bg-background/90 backdrop-blur-md' : 'bg-transparent'
        }`}
      >
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-4 sm:px-6 lg:px-10">
          <Link
            to={href('/')}
            aria-label={`${config.storeName} home`}
            className="flex-none font-grotesk text-[17px] uppercase leading-none text-ink"
          >
            Orbis <span className="text-muted">Store</span>
            <span className="ml-1.5 font-mono text-[10px] tracking-widest text-muted">
              {config.countryCode}
            </span>
          </Link>

          <nav className="ml-6 hidden flex-1 items-center gap-7 lg:flex">
            <NavLink to={href('/shop')} end className={linkClass}>
              Shop all
            </NavLink>
            {CATEGORIES.map((cat) => (
              <NavLink key={cat.id} to={href(`/shop/${cat.id}`)} className={linkClass}>
                {cat.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <form onSubmit={submitSearch} className="hidden items-center md:flex">
              <div
                className={`flex items-center overflow-hidden rounded-full border border-ink/15 bg-ink/5 transition-all ${
                  searchOpen ? 'w-56 px-3' : 'w-9 px-0'
                }`}
              >
                <button
                  type={searchOpen ? 'submit' : 'button'}
                  onClick={() => !searchOpen && setSearchOpen(true)}
                  aria-label="Search products"
                  className="flex h-9 w-9 flex-none items-center justify-center text-ink/80 hover:text-ink"
                >
                  <Search size={16} strokeWidth={1.8} />
                </button>
                {searchOpen && (
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onBlur={() => !query && setSearchOpen(false)}
                    placeholder="Search the store"
                    className="w-full bg-transparent py-2 font-mono text-[12px] text-ink outline-none placeholder:text-muted"
                  />
                )}
              </div>
            </form>

            <RegionSwitcher />

            <button
              type="button"
              onClick={open}
              aria-label={`Open cart, ${count} item${count === 1 ? '' : 's'}`}
              className="press relative flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 bg-ink/5 text-ink transition-colors hover:border-ink/30"
            >
              <ShoppingBag size={16} strokeWidth={1.8} />
              {count > 0 && (
                // Re-keying on the count restarts the pop animation, so the
                // badge visibly reacts every time something is added.
                <span
                  key={count}
                  className="animate-cart-pop absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-neon px-1 font-mono text-[10px] font-bold text-ink"
                >
                  {count}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 bg-ink/5 text-ink lg:hidden"
            >
              <Menu size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </header>

      {/* mobile sheet */}
      {menuOpen && (
        <div className="fixed inset-0 z-[80] bg-background lg:hidden">
          <div className="flex items-center justify-between px-4 py-5">
            <span className="font-grotesk text-[17px] uppercase text-ink">
              Orbis <span className="text-muted">Store</span> {config.countryCode}
            </span>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 text-ink"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={submitSearch} className="px-4 pb-4">
            <div className="flex items-center gap-2 rounded-full border border-ink/15 bg-ink/5 px-4">
              <Search size={16} className="text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the store"
                className="w-full bg-transparent py-3 font-mono text-[13px] text-ink outline-none placeholder:text-muted"
              />
            </div>
          </form>

          <nav className="flex flex-col px-4">
            <Link
              to={href('/shop')}
              onClick={() => setMenuOpen(false)}
              className="border-b border-ink/10 py-4 font-grotesk text-[20px] uppercase text-ink"
            >
              Shop all
            </Link>
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.id}
                to={href(`/shop/${cat.id}`)}
                onClick={() => setMenuOpen(false)}
                className="border-b border-ink/10 py-4 font-grotesk text-[20px] uppercase text-ink"
              >
                {cat.label}
              </Link>
            ))}
            <Link
              to={href('/orders')}
              onClick={() => setMenuOpen(false)}
              className="border-b border-ink/10 py-4 font-grotesk text-[20px] uppercase text-ink"
            >
              Order lookup
            </Link>
          </nav>

          <div className="px-4 py-6">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Store</div>
            <RegionSwitcher />
          </div>
        </div>
      )}
    </>
  )
}
