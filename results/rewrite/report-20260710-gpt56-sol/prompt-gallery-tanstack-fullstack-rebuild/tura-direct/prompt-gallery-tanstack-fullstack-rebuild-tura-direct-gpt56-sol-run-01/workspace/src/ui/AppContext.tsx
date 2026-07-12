import { createContext, useContext, useState, type ReactNode } from 'react'

type Toast = { id: number; message: string }
type AppContextValue = { cartCount: number; setCartCount: (count: number) => void; toast: (message: string) => void }
const Context = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [cartCount, setCartCount] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  function toast(message: string) {
    const id = Date.now()
    setToasts((current) => [...current, { id, message }])
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 2600)
  }
  return <Context.Provider value={{ cartCount, setCartCount, toast }}>{children}<div className="toast-stack" aria-live="polite">{toasts.map((item) => <div className="toast" key={item.id}><span />{item.message}</div>)}</div></Context.Provider>
}

export function useApp() {
  const value = useContext(Context)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
