import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type React from 'react'

type ToastContextValue = { showToast: (message: string) => void }
const ToastContext = createContext<ToastContextValue>({ showToast: () => undefined })

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState('')
  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2100)
  }, [])
  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">
        <span className="d" />
        <span>{toast}</span>
      </div>
    </ToastContext.Provider>
  )
}
