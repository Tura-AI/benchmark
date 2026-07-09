import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const ToastContext = createContext<(message: string) => void>(() => undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('')
  const [visible, setVisible] = useState(false)
  const show = useCallback((next: string) => {
    setMessage(next)
    setVisible(true)
    window.setTimeout(() => setVisible(false), 2200)
  }, [])
  const value = useMemo(() => show, [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={`toast ${visible ? 'show' : ''}`} role="status" aria-live="polite">
        <span className="d" />
        <span>{message}</span>
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
