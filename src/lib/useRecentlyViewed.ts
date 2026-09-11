import { useEffect, useState } from 'react'
import { useRegion } from '../regions/RegionContext'
import { STORAGE_KEYS, readJson, writeJson } from './storage'

const MAX = 8

/**
 * Records what a shopper has looked at, most recent first, scoped to the
 * storefront they were in. Purely a browsing convenience — it never
 * leaves the device.
 */
export function useRecentlyViewed(currentId?: string) {
  const { region } = useRegion()
  const key = STORAGE_KEYS.recentlyViewed(region)
  const [ids, setIds] = useState<string[]>(() => readJson<string[]>(key, []))

  useEffect(() => {
    const stored = readJson<string[]>(key, [])
    if (!currentId) {
      setIds(stored)
      return
    }
    // Expose the list as it was *before* this visit, so a product page
    // does not list the product you are already looking at.
    setIds(stored.filter((id) => id !== currentId))
    writeJson(key, [currentId, ...stored.filter((id) => id !== currentId)].slice(0, MAX))
  }, [key, currentId])

  return ids
}
