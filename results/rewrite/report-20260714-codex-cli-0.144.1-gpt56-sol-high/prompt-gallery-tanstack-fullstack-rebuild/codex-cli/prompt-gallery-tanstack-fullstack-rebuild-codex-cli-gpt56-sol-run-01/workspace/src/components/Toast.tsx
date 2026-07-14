export function Toast({ message }: { message: string }) {
  return <div className={`toast ${message ? 'is-visible' : ''}`} role="status"><span />{message}</div>
}
