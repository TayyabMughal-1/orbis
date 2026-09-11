import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api/client'

type AsyncState<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

type Options = {
  /**
   * Set false to hold the request back. Used where a call would be
   * meaningless until some precondition is met — quoting an empty cart,
   * for instance, which the API rightly rejects.
   */
  enabled?: boolean
}

/**
 * Runs an async loader whenever `deps` change, ignoring the result of
 * any call that has been superseded — so a fast filter change can never
 * be overwritten by a slower earlier request landing late.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  options: Options = {},
): AsyncState<T> & { reload: () => void } {
  const enabled = options.enabled ?? true
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: enabled, error: null })
  const [nonce, setNonce] = useState(0)
  const runId = useRef(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null })
      return
    }

    const id = runId.current + 1
    runId.current = id
    let alive = true

    setState((prev) => ({ data: prev.data, loading: true, error: null }))

    loader()
      .then((data) => {
        if (!alive || runId.current !== id) return
        setState({ data, loading: false, error: null })
      })
      .catch((err) => {
        if (!alive || runId.current !== id) return
        setState({ data: null, loading: false, error: errorMessage(err) })
      })

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled])

  return { ...state, reload }
}
