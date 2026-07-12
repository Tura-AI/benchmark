import { Link } from '@tanstack/react-router'
import { BarChart3, Bookmark, Code2, Gift, Heart, History, Home, Image, Menu, Search, ShoppingBag, X } from 'lucide-react'
import { useState } from 'react'
import { Brand } from './Brand'

const categories = ['Image', 'Photography', 'Design', 'Writing', 'Code', 'Marketing', 'Productivity', 'Research']

export function AppShell({ children, cartCount = 0, onSearch, favoritesActive = false, category = 'all', onCategory, onFavorites }: {
  children: React.ReactNode; cartCount?: number; onSearch?: () => void; favoritesActive?: boolean; category?: string;
  onCategory?: (category: string) => void; onFavorites?: () => void
}) {
  const [drawer, setDrawer] = useState(false)
  const close = () => setDrawer(false)
  return <div className="app-shell">
    <aside className={`sidebar ${drawer ? 'sidebar--open' : ''}`} aria-label="Primary navigation">
      <div className="sidebar__mobile-close"><button className="icon-button" onClick={close} aria-label="Close menu"><X /></button></div>
      <Brand />
      <Link className="nav-item" activeProps={{ className: 'nav-item nav-item--active' }} to="/" onClick={close}><Home />Home</Link>
      <button className="nav-item" onClick={() => { onSearch?.(); close() }}><Search />Search</button>
      <span className="nav-item nav-item--muted" aria-disabled="true"><History />History</span>
      <button className={`nav-item ${favoritesActive ? 'nav-item--active' : ''}`} onClick={() => { onFavorites?.(); close() }}><Heart />Favorites <span className="new-pill">NEW</span></button>

      {onCategory && <><p className="side-label">Categories</p><div className="categories">
        {categories.map((name) => <button key={name} className={`category ${category === name ? 'category--active' : ''}`} onClick={() => { onCategory(name); close() }}><span />{name}</button>)}
      </div></>}

      <p className="side-label">Workspace</p>
      <Link className="nav-item" activeProps={{ className: 'nav-item nav-item--active' }} to="/creator/analytics" onClick={close}><BarChart3 />Creator analytics</Link>
      <Link className="nav-item" activeProps={{ className: 'nav-item nav-item--active' }} to="/cart" onClick={close}><ShoppingBag />Cart {cartCount > 0 && <span className="count-pill">{cartCount}</span>}</Link>
      <span className="nav-item nav-item--muted" aria-disabled="true"><Code2 />Public API</span>

      <div className="sidebar__foot">
        <Link to="/creator/analytics" className="promo"><Gift /><strong>Sell your prompts</strong><span>Keep 85% of every sale.</span></Link>
        <a className="primary-button" href="/creator/analytics">Get started</a>
        <div className="legal"><span>Terms</span><span>Privacy</span><span>Refund</span><b>★ 4.8</b></div>
      </div>
    </aside>
    {drawer && <button className="scrim" onClick={close} aria-label="Close menu" />}
    <div className="main-column">
      <header className="mobile-header"><button className="icon-button" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu /></button><Brand compact /></header>
      {children}
    </div>
    <nav className="dock" aria-label="Quick actions">
      <Link to="/" aria-label="Home" activeProps={{ className: 'dock__active' }}><Home /></Link>
      <button aria-label="Search" onClick={onSearch}><Search /></button>
      <button aria-label="Favorites" onClick={onFavorites} className={favoritesActive ? 'dock__active' : ''}><Bookmark /></button>
      <Link to="/creator/analytics" aria-label="Creator analytics"><Image /></Link>
      <Link to="/cart" aria-label={`Cart, ${cartCount} items`}><ShoppingBag />{cartCount > 0 && <span>{cartCount}</span>}</Link>
    </nav>
  </div>
}
