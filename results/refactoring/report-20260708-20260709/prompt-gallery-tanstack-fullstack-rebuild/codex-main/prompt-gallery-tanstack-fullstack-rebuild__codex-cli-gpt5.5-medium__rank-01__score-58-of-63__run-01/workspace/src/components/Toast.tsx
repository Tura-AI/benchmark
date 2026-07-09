import { useEffect } from 'react'
import type { Toast as ToastType } from './types'

export function Toast({
  toast,
  onDone,
}: {
  toast: ToastType | null
  onDone: () => void
}) {
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(onDone, 2200)
    return () => window.clearTimeout(timer)
  }, [toast, onDone])

  return (
    <div className={`toast ${toast ? 'show' : ''}`}>
      <span className="toast-dot" />
      <span>{toast?.text}</span>
    </div>
  )
}
