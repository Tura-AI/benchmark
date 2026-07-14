import { Link } from '@tanstack/react-router'
import { Icon } from './Icon'

export function Logo({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className={`logo ${compact ? 'compact' : ''}`} aria-label="POWERPROMPT home">
    <span className="bolt"><Icon name="bolt" /></span>
    <b>POWERPROMPT</b>{!compact && <em>Gallery</em>}
  </Link>
}
