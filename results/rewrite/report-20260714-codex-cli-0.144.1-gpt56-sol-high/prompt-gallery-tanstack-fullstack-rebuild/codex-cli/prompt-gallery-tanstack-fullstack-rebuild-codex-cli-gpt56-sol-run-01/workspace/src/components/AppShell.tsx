import { Link, useLocation } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { Brand } from './Brand'
import { Icon } from './Icons'

type Props = {
  children: ReactNode
  categories?: Array<{ name: string; count: number }>
  activeCategory?: string
  cartCount?: number
  onCategory?: (name: string) => void
  onSearch?: () => void
  onFavorites?: () => void
  onNotice?: (text: string) => void
}

export function AppShell({ children, categories = [], activeCategory = 'all', cartCount = 0, onCategory, onSearch, onFavorites, onNotice }: Props) {
  const [drawer, setDrawer] = useState(false)
  const pathname = useLocation({ select: (l) => l.pathname })
  const close = () => setDrawer(false)
  const notice = (text: string) => { close(); onNotice?.(text) }
  return <div className="app-shell">
    <aside className={`sidebar ${drawer ? 'sidebar--open' : ''}`} aria-label="Primary navigation">
      <Brand />
      <nav className="side-nav" aria-label="Primary navigation">
        <Link to="/" className={`nav-item ${pathname === '/' ? 'is-active' : ''}`} onClick={close}><Icon name="home" />Home</Link>
        <button className="nav-item" onClick={() => { close(); onSearch?.() }}><Icon name="search" />Search</button>
        <button className="nav-item" onClick={() => notice('Your viewing history is clear')}><Icon name="history" />History</button>
        <button className="nav-item" onClick={() => { close(); onFavorites?.() }}><Icon name="heart" />Favorites <span className="new-badge">NEW</span></button>
        <Link to="/cart" className={`nav-item ${pathname === '/cart' ? 'is-active' : ''}`} onClick={close}><Icon name="cart" />Cart {cartCount > 0 && <span className="nav-count">{cartCount}</span>}</Link>
      </nav>

      {!!categories.length && <><p className="side-label">Categories</p><div className="category-list">
        {categories.map((category) => <button key={category.name} className={`category ${activeCategory === category.name ? 'is-active' : ''}`} onClick={() => { close(); onCategory?.(category.name) }}><span className="category__dot" />{category.name}<span>{category.count}</span></button>)}
      </div></>}

      <p className="side-label">Workspace</p>
      <nav className="side-nav" aria-label="Workspace navigation">
        <Link to="/analytics" className={`nav-item ${pathname === '/analytics' ? 'is-active' : ''}`} onClick={close}><Icon name="chart" />Creator analytics</Link>
        <button className="nav-item" onClick={() => notice('Browser extension — coming soon')}><Icon name="external" />Browser extension</button>
        <button className="nav-item" onClick={() => notice('Public API docs — coming soon')}><Icon name="code" />Public API</button>
      </nav>
      <div className="sidebar__footer">
        <Link to="/analytics" className="seller-card"><Icon name="spark" /><strong>Sell your prompts</strong><span>Keep 85% of every sale — paid weekly.</span></Link>
        <div className="side-actions"><Link to="/analytics" className="button button--dark">Get started</Link><button onClick={() => { close(); onCategory?.('__free') }}>Free prompts</button></div>
        <small>Terms · Privacy · Refund <span>★ 4.8</span></small>
      </div>
    </aside>
    <button className={`scrim ${drawer ? 'is-open' : ''}`} onClick={close} aria-label="Close menu" />
    <div className="page">
      <header className="mobile-head"><button onClick={() => setDrawer(true)} aria-label="Open menu"><Icon name="menu" /></button><Brand compact /></header>
      {children}
    </div>
    <MobileDock cartCount={cartCount} pathname={pathname} onSearch={onSearch} onFavorites={onFavorites} onNotice={onNotice} />
  </div>
}

function MobileDock({ cartCount, pathname, onSearch, onFavorites, onNotice }: { cartCount: number; pathname: string; onSearch?: () => void; onFavorites?: () => void; onNotice?: (s:string) => void }) {
  return <nav className="dock" aria-label="Mobile navigation">
    <Link to="/" className={pathname === '/' ? 'is-active' : ''} aria-label="Home"><Icon name="home" /></Link>
    <button onClick={onSearch} aria-label="Search"><Icon name="search" /></button>
    <button onClick={onFavorites} aria-label="Favorites"><Icon name="heart" /></button>
    <Link to="/analytics" className={pathname === '/analytics' ? 'is-active' : ''} aria-label="Analytics"><Icon name="chart" /></Link>
    <Link to="/cart" className={pathname === '/cart' ? 'is-active' : ''} aria-label="Cart"><Icon name="cart" />{cartCount > 0 && <span>{cartCount}</span>}</Link>
    <button onClick={() => onNotice?.('In-app generation — coming soon')} aria-label="Generate"><Icon name="spark" /></button>
  </nav>
}
