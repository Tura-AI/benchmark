import { Link } from '@tanstack/react-router'
import { Icons } from './icons'

export function MobileTop({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="mtop">
      <button className="burger" aria-label="Menu" onClick={onMenu}>
        <Icons.Menu />
      </button>
      <Link to="/" className="mobile-brand">
        <span className="bolt">
          <Icons.Zap fill="currentColor" />
        </span>
        <b>POWERPROMPT</b>
      </Link>
    </div>
  )
}
