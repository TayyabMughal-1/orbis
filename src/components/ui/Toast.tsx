import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertCircle, Check, X } from 'lucide-react'

// ---------------------------------------------------------------------
// Toasts.
//
// Adding to the cart used to throw the whole drawer open, which yanks a
// shopper out of the grid they were browsing. A toast confirms the same
// thing without taking the page away, and offers the drawer as a choice.
//
// The live region is polite and always mounted, so a screen reader
// announces each confirmation without the container itself jumping in
// and out of the accessibility tree.
// ---------------------------------------------------------------------

type Toast = {
  id: number
  message: string
  detail?: string
  tone: 'success' | 'error'
  action?: { label: string; onClick: () => void }
}

type ToastContextValue = {
  notify: (toast: Omit<Toast, 'id'>) => void
  success: (message: string, detail?: string, action?: Toast['action']) => void
  error: (message: string, detail?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DURATION = 4200

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const notify = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++
      // Keep at most three on screen; older ones drop off the top.
      setToasts((prev) => [...prev.slice(-2), { ...toast, id }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION),
      )
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      notify,
      success: (message, detail, action) => notify({ message, detail, tone: 'success', action }),
      error: (message, detail) => notify({ message, detail, tone: 'error' }),
    }),
    [notify],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-1/2 z-[95] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`animate-slide-up-in pointer-events-auto flex items-start gap-3 rounded-[14px] border p-3.5 shadow-pop backdrop-blur-md sm:animate-slide-in-right ${
              toast.tone === 'success'
                ? 'border-accent/25 bg-[#F2FBEA]'
                : 'border-red-500/25 bg-[#FEF2F2]'
            }`}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full ${
                toast.tone === 'success' ? 'bg-accent text-background' : 'bg-red-600 text-background'
              }`}
            >
              {toast.tone === 'success' ? (
                <Check size={13} strokeWidth={3} />
              ) : (
                <AlertCircle size={13} strokeWidth={2.5} />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="font-grotesk text-[12px] uppercase text-ink">{toast.message}</p>
              {toast.detail && (
                <p className="mt-0.5 truncate font-body text-[11px] text-muted">{toast.detail}</p>
              )}
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onClick()
                    dismiss(toast.id)
                  }}
                  className="mt-2 font-body text-[11px] uppercase text-accent underline underline-offset-4"
                >
                  {toast.action.label}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="flex-none text-muted transition-colors hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside a ToastProvider')
  return ctx
}
