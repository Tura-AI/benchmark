export function Toast({ message }: { message: string }) {
  return <div className={`toast ${message ? 'show' : ''}`} role="status" aria-live="polite"><span className="toast-dot" />{message}</div>
}
