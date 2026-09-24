import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { DEFAULT_REGION, isRegionCode, REGIONS, type RegionCode } from './regions/config'
import { detectRegionSync } from './regions/detect'
import { RegionProvider } from './regions/RegionContext'
import { CartProvider } from './context/CartContext'
import { STORAGE_KEYS, readString } from './lib/storage'

import Header from './components/Header'
import Footer from './components/Footer'
import CartDrawer from './components/CartDrawer'
import RegionNotice from './components/RegionNotice'
import { ToastProvider } from './components/ui/Toast'

import Home from './pages/Home'
import Catalog from './pages/Catalog'
import ProductDetail from './pages/ProductDetail'
import CartPage from './pages/CartPage'
import Checkout from './pages/Checkout'
import OrderConfirmation from './pages/OrderConfirmation'
import OrderLookup from './pages/OrderLookup'
import Account from './pages/Account'
import Help from './pages/Help'
import NotFound from './pages/NotFound'

import AdminShell from './admin/AdminShell'
import { AdminProductEditor, AdminProductList } from './admin/AdminProducts'
import { AdminOrders, AdminPromos, AdminSettings } from './admin/AdminRest'
import AdminTaxonomy from './admin/AdminTaxonomy'

// ---------------------------------------------------------------------
// Routing
//
// Every shopping URL is region-first: /us/shop, /ae/product/halo-pendant,
// /pk/checkout. That gives each market its own indexable, shareable set
// of URLs — three websites off one codebase — and means the region is
// never ambiguous on a cold load.
//
// A bare "/" resolves to a storefront: a remembered choice first, then
// the browser's own timezone/language, then DEFAULT_REGION.
// ---------------------------------------------------------------------

function initialRegion(): RegionCode {
  const remembered = readString(STORAGE_KEYS.region)
  if (isRegionCode(remembered)) return remembered
  return detectRegionSync() ?? DEFAULT_REGION
}

/** Sends "/" and any unprefixed path into the right storefront. */
function RegionGate() {
  const location = useLocation()
  const region = initialRegion()
  const rest = location.pathname === '/' ? '' : location.pathname
  return <Navigate to={`/${region}${rest}${location.search}`} replace />
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}

/** The chrome shared by every page inside a storefront. */
function StoreLayout() {
  const { region } = useParams()
  const location = useLocation()

  if (!isRegionCode(region)) {
    // Unknown prefix — treat the whole path as un-regioned and resolve it.
    return <Navigate to={`/${initialRegion()}${location.pathname}${location.search}`} replace />
  }

  return (
    <RegionProvider region={region}>
      <ToastProvider>
        <CartProvider>
          {/* --accent is set here rather than on <html>, so it is scoped
              to a storefront: the dashboard and the region gate keep the
              default. Every text-accent, bg-accent and border-accent in
              the app resolves against it, which is how one line retints
              the whole store. */}
          <div
            className="relative flex min-h-screen flex-col overflow-x-hidden bg-background font-body text-ink"
            style={{ '--accent': REGIONS[region].theme.accent } as CSSProperties}
          >
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-neon focus:px-5 focus:py-2.5 focus:font-grotesk focus:text-[14px] focus:uppercase focus:text-ink"
            >
              Skip to content
            </a>
            <RegionNotice />
            <Header />
            {/* Re-keying on the path replays the fade, so each page
                arrives rather than snapping into place. */}
            <main id="main" key={location.pathname} className="flex-1 animate-fade-in">
              <Outlet />
            </main>
            <Footer />
            <CartDrawer />
          </div>
        </CartProvider>
      </ToastProvider>
    </RegionProvider>
  )
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* The dashboard sits outside the storefront entirely: no region
            prefix, no cart, no region chrome. It is a different app that
            happens to share a bundle. */}
        <Route path="/admin" element={<AdminShell />}>
          <Route index element={<AdminProductList />} />
          <Route path="products/:slug" element={<AdminProductEditor />} />
          <Route path="taxonomy" element={<AdminTaxonomy />} />
          <Route path="promos" element={<AdminPromos />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>

        <Route path="/" element={<RegionGate />} />
        <Route path="/:region" element={<StoreLayout />}>
          <Route index element={<Home />} />
          <Route path="shop" element={<Catalog />} />
          <Route path="shop/:category" element={<Catalog />} />
          <Route path="product/:slug" element={<ProductDetail />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="orders" element={<OrderLookup />} />
          <Route path="account" element={<Account />} />
          <Route path="help" element={<Help />} />
          <Route path="order/:number" element={<OrderConfirmation />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  )
}

// Re-exported so a future sitemap generator has one source of truth for
// which storefronts exist.
export const STOREFRONT_PATHS = Object.keys(REGIONS).map((code) => `/${code}`)
