import { Link } from '@tanstack/react-router'
import { Icons } from './icons'

export function Dock({
  cartCount,
  onFavorites,
  onSearch,
}: {
  cartCount: number
  onFavorites: () => void
  onSearch: () => void
}) {
  return (
    <nav className="dock" aria-label="Quick actions">
      <Link to="/" className="dock-btn active" aria-label="Home">
        <Icons.Home />
      </Link>
      <button className="dock-btn" aria-label="Search" onClick={onSearch}>
        <Icons.Search />
      </button>
      <button className="dock-btn" aria-label="Favorites" onClick={onFavorites}>
        <Icons.Heart />
      </button>
      <Link to="/creator" className="dock-btn" aria-label="Analytics">
        <Icons.BarChart3 />
      </Link>
      <Link to="/cart" className="dock-btn" aria-label="Cart">
        <Icons.ShoppingBag />
        <span className={`cbadge ${cartCount ? 'show' : ''}`}>{cartCount}</span>
      </Link>
      <button className="dock-btn" aria-label="Generate">
        <Icons.Wand2 />
      </button>
    </nav>
  )
}
