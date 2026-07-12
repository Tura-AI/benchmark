import { Link, useNavigate } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { categories } from '../data/seed'
import { Bolt, Icons } from './icons'

export function AppShell({ children, cartCount = 0 }: { children: ReactNode; cartCount?: number }) {
  const [drawer, setDrawer] = useState(false)
  const navigate = useNavigate()

  const close = () => setDrawer(false)
  return (
    <div className="app">
      <aside className={`sidebar ${drawer ? 'open' : ''}`} aria-label="Marketplace navigation">
        <Link className="logo" to="/" onClick={close}>
          <Bolt />
          <b>POWERPROMPT</b><span>Gallery</span>
        </Link>
        <Link className="navi" activeProps={{ className: 'navi active' }} to="/" onClick={close}><Icons.Home /> Home</Link>
        <button className="navi" type="button" onClick={() => window.dispatchEvent(new Event('powerprompt:search'))}><Icons.Search /> Search</button>
        <button className="navi" type="button" onClick={() => window.dispatchEvent(new CustomEvent('powerprompt:toast', { detail: 'History is empty for now' }))}><Icons.Clock3 /> History</button>
        <Link className="navi" to="/" search={{ favorites: '1', model: 'all', category: 'all', sort: 'featured', q: '' }} onClick={close}><Icons.Heart /> Favorites <span className="new">NEW</span></Link>
        <div className="side-label">Categories</div>
        {categories.map((category) => (
          <button key={category} className="cat" type="button" onClick={() => { close(); void navigate({ to: '/', search: { category, model: 'all', sort: 'featured', q: '', favorites: undefined, free: undefined } }) }}>
            <span className="dot" />{category}
          </button>
        ))}
        <div className="side-label">More from us</div>
        <button className="navi" type="button" onClick={() => window.dispatchEvent(new CustomEvent('powerprompt:toast', { detail: 'Browser extension - coming soon' }))}><Icons.Boxes /> Browser extension</button>
        <Link className="navi" to="/analytics" onClick={close}><Icons.Code2 /> Creator analytics</Link>
        <button className="navi" type="button" onClick={() => window.dispatchEvent(new CustomEvent('powerprompt:toast', { detail: 'Public API: /api/prompts, /api/cart, /api/analytics' }))}><Icons.Code2 /> Public API</button>
        <div className="side-foot">
          <div className="promo-card"><Icons.Gift /><h4>Sell your prompts</h4><p>Keep 85% of every sale - paid weekly.</p></div>
          <div className="side-cta"><Link className="btn-ink" to="/analytics">Get started</Link><Link className="free" to="/" search={{ free: '1', model: 'all', category: 'all', sort: 'featured', q: '' }}>Free prompts</Link></div>
          <div className="side-legal"><span>Terms</span> · <span>Privacy</span> · <span>Refund</span><span className="stars"><Icons.Star size={11} fill="currentColor" /> 4.8</span></div>
        </div>
      </aside>
      <div className={`scrim ${drawer ? 'show' : ''}`} onClick={close} />
      <main className="main">
        <div className="mtop">
          <button className="burger" type="button" aria-label="Menu" onClick={() => setDrawer(true)}><Icons.Menu size={20} /></button>
          <Bolt small /><b>POWERPROMPT</b>
        </div>
        {children}
      </main>
      <nav className="dock" aria-label="Quick actions">
        <Link to="/" activeProps={{ className: 'active' }}><Icons.Home /></Link>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('powerprompt:toast', { detail: 'History is empty for now' }))}><Icons.Clock3 /></button>
        <Link to="/" search={{ favorites: '1', model: 'all', category: 'all', sort: 'featured', q: '' }}><Icons.Heart /></Link>
        <Link to="/analytics"><Icons.Boxes /></Link>
        <Link to="/cart"><Icons.ShoppingBag />{cartCount > 0 ? <span className="cbadge">{cartCount}</span> : null}</Link>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('powerprompt:toast', { detail: 'In-app generation - coming soon' }))}><Icons.Wand2 /></button>
      </nav>
    </div>
  )
}
