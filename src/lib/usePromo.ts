import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../api/client'
import { useRegion } from '../regions/RegionContext'
import { STORAGE_KEYS, readString, removeKey, writeString } from './storage'

/**
 * A promo code entered in the cart should survive the walk to checkout,
 * but it belongs to one storefront — GULF15 is meaningless on /us — so
 * it is stored per region and re-validated server-side on every quote.
 */
export function usePromo(subtotal: number) {
  const { region } = useRegion()
  const key = STORAGE_KEYS.promo(region)

  const [code, setCode] = useState<string | null>(() => readString(key))
  const [label, setLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setCode(readString(key))
    setLabel(null)
    setError(null)
  }, [key])

  // Confirm a restored code is still valid for this basket.
  //
  // Waits for a real subtotal. The cart's catalogue arrives a moment
  // after mount, and re-checking against a subtotal of zero would fail
  // every minimum-spend code and flash a wrong error at the customer.
  useEffect(() => {
    if (!code || subtotal <= 0) return
    let alive = true
    api
      .validatePromo(code, region, subtotal)
      .then((result) => {
        if (alive) {
          setLabel(result.label)
          setError(null)
        }
      })
      .catch((err) => {
        if (alive) {
          setLabel(null)
          setError(errorMessage(err))
        }
      })
    return () => {
      alive = false
    }
  }, [code, region, subtotal])

  const apply = useCallback(
    async (next: string) => {
      if (subtotal <= 0) {
        setError('Add something to your cart before applying a code.')
        return
      }
      setBusy(true)
      setError(null)
      try {
        const result = await api.validatePromo(next, region, subtotal)
        setCode(result.code)
        setLabel(result.label)
        writeString(key, result.code)
      } catch (err) {
        setError(errorMessage(err))
        setLabel(null)
      } finally {
        setBusy(false)
      }
    },
    [region, subtotal, key],
  )

  const clear = useCallback(() => {
    setCode(null)
    setLabel(null)
    setError(null)
    removeKey(key)
  }, [key])

  return { code, label, error, busy, apply, clear }
}
