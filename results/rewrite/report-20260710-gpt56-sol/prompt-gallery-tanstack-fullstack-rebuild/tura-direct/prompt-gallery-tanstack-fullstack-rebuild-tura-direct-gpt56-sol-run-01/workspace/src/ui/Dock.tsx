import { Link } from '@tanstack/react-router'
import { BarChart3, Heart, Home, Search, ShoppingBag } from 'lucide-react'
import { useApp } from './AppContext'

export function Dock() {
  const { cartCount } = useApp()
  return <nav className="dock" aria-label="Quick navigation">
    <Link to="/" activeOptions={{ exact: true }} aria-label="Home"><Home /></Link>
    <Link to="/" search={{ view: 'search' }} aria-label="Search"><Search /></Link>
    <Link to="/" search={{ view: 'favorites' }} aria-label="Favorites"><Heart /></Link>
    <Link to="/creator" aria-label="Creator analytics"><BarChart3 /></Link>
    <Link to="/cart" aria-label={`Cart, ${cartCount} items`} className="badge-wrap"><ShoppingBag />{cartCount > 0 && <b>{cartCount}</b>}</Link>
  </nav>
}
