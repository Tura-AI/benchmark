import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { categories } from '../data/seed-data'
import { Icon } from './Icon'
import { Logo } from './Logo'

type Props = {
  children: ReactNode
  cartCount?: number
  activeCategory?: string
  favoritesActive?: boolean
  onSearch?: () => void
  onFavorites?: () => void
  onCategory?: (category: string) => void
  onNotice?: (message: string) => void
}

export function MarketplaceShell({ children, cartCount = 0, activeCategory, favoritesActive, onSearch, onFavorites, onCategory, onNotice }: Props) {
  const [drawer, setDrawer] = useState(false)
  const path = useLocation({ select: (s) => s.pathname })
  const close = () => setDrawer(false)
  const notice = (message: string) => { close(); onNotice?.(message) }
  return <div className="app-shell">
    <aside className={`sidebar ${drawer ? 'open' : ''}`} aria-label="Marketplace navigation">
      <Logo />
      <nav className="side-nav">
        <Link to="/" onClick={close} className={`navi ${path === '/' && !favoritesActive && !activeCategory ? 'active' : ''}`}><Icon name="home" />Home</Link>
        <button className="navi" onClick={() => { close(); onSearch?.() }}><Icon name="search" />Search <kbd>⌘ K</kbd></button>
        <button className="navi" onClick={() => notice('History is empty for now')}><Icon name="clock" />History</button>
        <button className={`navi ${favoritesActive ? 'active' : ''}`} onClick={() => { close(); onFavorites?.() }}><Icon name="heart" />Favorites <span className="new">NEW</span></button>
      </nav>
      <p className="side-label">Categories</p>
      <div className="category-nav">{categories.map((category) => <button key={category} className={`cat ${activeCategory === category.toLowerCase() ? 'active' : ''}`} onClick={() => { close(); onCategory?.(category.toLowerCase()) }}><span className="dot" />{category}</button>)}</div>
      <p className="side-label">Workspace</p>
      <Link to="/analytics" onClick={close} className={`navi ${path === '/analytics' ? 'active' : ''}`}><Icon name="chart" />Creator analytics</Link>
      <button className="navi" onClick={() => notice('Public API access is included with Pro')}><Icon name="grid" />Public API</button>
      <div className="side-foot">
        <div className="promo-card"><Icon name="gift" /><h4>Sell your prompts</h4><p>Keep 85% of every sale — paid weekly.</p></div>
        <Link to="/analytics" className="btn-ink">Get started</Link>
        <div className="side-legal"><span>Terms · Privacy · Refund</span><span>★ 4.8</span></div>
      </div>
    </aside>
    <button className={`scrim ${drawer ? 'show' : ''}`} aria-label="Close menu" onClick={close} />
    <main className="main">
      <div className="mobile-top"><button aria-label="Open menu" onClick={() => setDrawer(true)}><Icon name="menu" /></button><Logo compact /><Link to="/cart" className="mobile-cart"><Icon name="cart" />{cartCount > 0 && <span>{cartCount}</span>}</Link></div>
      {children}
    </main>
    <nav className="dock" aria-label="Mobile navigation">
      <Link to="/" className={path === '/' && !favoritesActive ? 'active' : ''} aria-label="Home"><Icon name="home" /></Link>
      <button aria-label="Search" onClick={onSearch}><Icon name="search" /></button>
      <button className={favoritesActive ? 'active' : ''} aria-label="Favorites" onClick={onFavorites}><Icon name="heart" /></button>
      <Link to="/analytics" className={path === '/analytics' ? 'active' : ''} aria-label="Analytics"><Icon name="chart" /></Link>
      <Link to="/cart" className={path === '/cart' ? 'active' : ''} aria-label="Cart"><Icon name="cart" />{cartCount > 0 && <span className="dock-badge">{cartCount}</span>}</Link>
    </nav>
  </div>
}
