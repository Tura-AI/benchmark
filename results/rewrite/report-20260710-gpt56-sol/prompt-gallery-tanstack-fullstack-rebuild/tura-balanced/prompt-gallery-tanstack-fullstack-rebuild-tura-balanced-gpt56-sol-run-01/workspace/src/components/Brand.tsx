import { Zap } from 'lucide-react'

export function Brand({ compact = false }: { compact?: boolean }) {
  return <a className={`brand ${compact ? 'brand--compact' : ''}`} href="/" aria-label="POWERPROMPT Gallery home">
    <span className="brand__bolt"><Zap aria-hidden="true" /></span>
    <strong>POWERPROMPT</strong>{!compact && <em>Gallery</em>}
  </a>
}
