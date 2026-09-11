import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'
import { useAsync } from '../lib/useAsync'
import { useRegion } from '../regions/RegionContext'
import { STORAGE_KEYS, readJson, removeKey, writeJson } from '../lib/storage'
import type { CartLine, Product, ResolvedLine, Variant } from '../types'

// ---------------------------------------------------------------------
// The cart is scoped to a storefront.
//
// A cart is priced in one currency and reserved against one warehouse,
// so /us and /ae keep separate carts rather than dragging US cents into
// an AED checkout. Switching region shows that region's own basket.
// ---------------------------------------------------------------------

type CartContextValue = {
  lines: CartLine[]
  resolved: ResolvedLine[]
  count: number
  subtotal: number
  isEmpty: boolean

  add: (product: Product, variant: Variant, quantity?: number) => void
  setQuantity: (variantId: string, quantity: number) => void
  remove: (variantId: string) => void
  clear: () => void
  quantityOf: (variantId: string) => number

  isOpen: boolean
  open: () => void
  close: () => void
  /** Set briefly after an add, so the drawer can highlight the new line. */
  lastAdded: string | null
}

const CartContext = createContext<CartContextValue | null>(null)

const MAX_PER_LINE = 10

export function CartProvider({ children }: { children: ReactNode }) {
  const { region } = useRegion()
  const storageKey = STORAGE_KEYS.cart(region)

  // Cart lines are stored as ids and quantities. Turning them into
  // something renderable needs prices and stock, which belong to the
  // backend — so the cart holds one catalogue read per storefront and
  // joins against it. (Prices are re-checked server-side at quote and
  // order time regardless; this copy is only for display.)
  const { data: catalogue } = useAsync(() => api.listProducts({ region }), [region])

  const [lines, setLines] = useState<CartLine[]>(() => readJson<CartLine[]>(storageKey, []))
  const [isOpen, setIsOpen] = useState(false)
  const [lastAdded, setLastAdded] = useState<string | null>(null)

  // Load the basket belonging to whichever storefront we are now in.
  useEffect(() => {
    setLines(readJson<CartLine[]>(storageKey, []))
  }, [storageKey])

  useEffect(() => {
    if (lines.length) writeJson(storageKey, lines)
    else removeKey(storageKey)
  }, [lines, storageKey])

  const stockOf = useCallback(
    (variantId: string) => {
      for (const product of catalogue ?? []) {
        const variant = product.variants.find((v) => v.id === variantId)
        if (variant) return variant.stock[region]
      }
      // Unknown until the catalogue lands — let the optimistic add
      // through and clamp once it does.
      return MAX_PER_LINE
    },
    [catalogue, region],
  )

  const add = useCallback(
    (product: Product, variant: Variant, quantity = 1) => {
      const available = variant.stock[region]
      if (available <= 0) return

      setLines((prev) => {
        const existing = prev.find((l) => l.variantId === variant.id)
        const ceiling = Math.min(available, MAX_PER_LINE)
        if (existing) {
          return prev.map((l) =>
            l.variantId === variant.id
              ? { ...l, quantity: Math.min(ceiling, l.quantity + quantity) }
              : l,
          )
        }
        return [
          ...prev,
          {
            productId: product.id,
            variantId: variant.id,
            quantity: Math.min(ceiling, quantity),
            addedAt: Date.now(),
          },
        ]
      })
      // Deliberately does NOT open the drawer — the caller shows a toast
      // instead, so browsing is never interrupted mid-grid.
      setLastAdded(variant.id)
    },
    [region],
  )

  const setQuantity = useCallback(
    (variantId: string, quantity: number) => {
      if (quantity <= 0) {
        setLines((prev) => prev.filter((l) => l.variantId !== variantId))
        return
      }
      const ceiling = Math.min(stockOf(variantId), MAX_PER_LINE)
      setLines((prev) =>
        prev.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(ceiling, quantity) } : l)),
      )
    },
    [stockOf],
  )

  const remove = useCallback((variantId: string) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  /**
   * Joins stored lines against the catalogue. A line whose product or
   * variant has since disappeared is dropped rather than throwing — a
   * stale cart must never block someone from shopping.
   */
  const resolved = useMemo<ResolvedLine[]>(() => {
    if (!catalogue) return []
    const rows: ResolvedLine[] = []
    for (const line of lines) {
      const product = catalogue.find((p) => p.id === line.productId)
      const variant = product?.variants.find((v) => v.id === line.variantId)
      if (!product || !variant) continue
      const unitPrice = variant.price[region]
      rows.push({
        line,
        product,
        variant,
        unitPrice,
        lineTotal: unitPrice * line.quantity,
        stock: variant.stock[region],
      })
    }
    return rows
  }, [lines, catalogue, region])

  // Counted from the stored lines, not the joined ones, so the badge is
  // correct on first paint instead of after the catalogue arrives.
  const count = useMemo(() => lines.reduce((n, l) => n + l.quantity, 0), [lines])
  const subtotal = useMemo(() => resolved.reduce((n, r) => n + r.lineTotal, 0), [resolved])

  const quantityOf = useCallback(
    (variantId: string) => lines.find((l) => l.variantId === variantId)?.quantity ?? 0,
    [lines],
  )

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      resolved,
      count,
      subtotal,
      isEmpty: lines.length === 0,
      add,
      setQuantity,
      remove,
      clear,
      quantityOf,
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      lastAdded,
    }),
    [lines, resolved, count, subtotal, add, setQuantity, remove, clear, quantityOf, isOpen, lastAdded],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside a CartProvider')
  return ctx
}
