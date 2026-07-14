import { Link } from '@tanstack/react-router'
import { Icon } from './Icons'

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className={compact ? 'brand brand--compact' : 'brand'} aria-label="POWERPROMPT home">
    <span className="brand__bolt"><Icon name="bolt" /></span>
    <strong>POWERPROMPT</strong>{!compact && <em>Gallery</em>}
  </Link>
}
