import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type ToastContextValue = { showToast: (message: string) => void }
const ToastContext = createContext<ToastContextValue>({ showToast: () => undefined })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState(false)

  const showToast = useCallback((next: string) => {
    setMessage(next)
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const timeout = window.setTimeout(() => setOpen(false), 1900)
    return () => window.clearTimeout(timeout)
  }, [open, message])

  const value = useMemo(() => ({ showToast }), [showToast])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={`toast ${open ? 'show' : ''}`} role="status" aria-live="polite">
        <span className="d" />
        <span>{message}</span>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
