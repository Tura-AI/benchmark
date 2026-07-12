import { Link, useRouterState } from '@tanstack/react-router'
import { BarChart3, Bookmark, Clock3, Code2, Gift, Home, Menu, Search, ShoppingBag, Sparkles, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

const categories = ['Image','Photography','Design','Writing','Code','Marketing','Productivity','Research']

function Brand() {
  return <Link to="/" className="brand" aria-label="POWERPROMPT home"><span className="brand-bolt"><Sparkles /></span><strong>POWERPROMPT</strong><em>Gallery</em></Link>
}

export function AppShell({ children, cartCount = 0, activeCategory, onCategory, onSearch }: {
  children: ReactNode; cartCount?: number; activeCategory?: string; onCategory?: (value: string) => void; onSearch?: () => void
}) {
  const [drawer, setDrawer] = useState(false)
  const path = useRouterState({ select: (s) => s.location.pathname })
  const close = () => setDrawer(false)
  return <div className="app-shell">
    <aside className={`sidebar ${drawer ? 'open' : ''}`} aria-label="Marketplace navigation">
      <div className="side-mobile-close"><button onClick={close} aria-label="Close menu"><X /></button></div>
      <Brand />
      <nav className="primary-nav">
        <Link to="/" activeOptions={{ exact: true }} onClick={close}><Home />Home</Link>
        <button onClick={() => { onSearch?.(); close() }}><Search />Search</button>
        <button onClick={() => close()}><Clock3 />History</button>
        <Link to="/" search={{ favorites: true }} onClick={close}><Bookmark />Favorites<span className="new-pill">NEW</span></Link>
      </nav>
      <p className="side-label">Categories</p>
      <nav className="category-nav">
        {categories.map((category) => <button key={category} className={activeCategory === category ? 'active' : ''} onClick={() => { onCategory?.(category); close() }}><i />{category}</button>)}
      </nav>
      <p className="side-label">Workspace</p>
      <nav className="primary-nav">
        <Link to="/analytics" onClick={close}><BarChart3 />Creator analytics</Link>
        <Link to="/api/catalog"><Code2 />Public API</Link>
      </nav>
      <div className="side-foot">
        <Link to="/analytics" className="sell-card"><Gift /><strong>Sell your prompts</strong><span>Keep 85% of every sale.</span></Link>
        <div className="side-actions"><Link to="/analytics">Get started</Link><Link to="/" search={{ free: true }}>Free prompts</Link></div>
        <small>Terms · Privacy · Refund <b>★ 4.8</b></small>
      </div>
    </aside>
    {drawer && <button className="scrim" onClick={close} aria-label="Close menu" />}
    <section className="app-main">
      <header className="mobile-head"><button onClick={() => setDrawer(true)} aria-label="Open menu"><Menu /></button><Brand /></header>
      {children}
    </section>
    <nav className="dock" aria-label="Quick actions">
      <Link to="/" className={path === '/' ? 'active' : ''} aria-label="Home"><Home /></Link>
      <button aria-label="Search" onClick={onSearch}><Search /></button>
      <Link to="/" search={{ favorites: true }} aria-label="Favorites"><Bookmark /></Link>
      <Link to="/analytics" aria-label="Creator analytics"><BarChart3 /></Link>
      <Link to="/cart" className={path === '/cart' ? 'active' : ''} aria-label={`Cart, ${cartCount} items`}><ShoppingBag />{cartCount > 0 && <span className="cart-badge">{cartCount}</span>}</Link>
    </nav>
  </div>
}
