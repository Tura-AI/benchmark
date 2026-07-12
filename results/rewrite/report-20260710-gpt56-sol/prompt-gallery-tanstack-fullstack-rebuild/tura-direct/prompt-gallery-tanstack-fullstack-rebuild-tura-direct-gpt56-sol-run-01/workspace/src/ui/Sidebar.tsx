import { Link } from '@tanstack/react-router'
import { BarChart3, ChevronRight, Gift, Heart, Home, Search, ShoppingBag, Sparkles, Zap } from 'lucide-react'

const categories = ['Image', 'Photography', 'Design', 'Marketing', 'Code', 'Writing', 'Research', 'Productivity']

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary navigation">
    <Link to="/" className="logo" onClick={onClose}><span className="bolt"><Zap /></span><b>POWER</b><em>PROMPT</em></Link>
    <nav className="primary-nav">
      <Link to="/" activeOptions={{ exact: true }} onClick={onClose}><Home />Discover</Link>
      <Link to="/" search={{ view: 'favorites' }} onClick={onClose}><Heart />Favorites</Link>
      <Link to="/" search={{ view: 'search' }} onClick={onClose}><Search />Search</Link>
      <Link to="/cart" onClick={onClose}><ShoppingBag />Cart</Link>
      <Link to="/creator" onClick={onClose}><BarChart3 />Creator analytics<span className="new">LIVE</span></Link>
    </nav>
    <p className="side-label">Browse categories</p>
    <nav className="category-nav">{categories.map((category) => <Link key={category} to="/" search={{ category }} onClick={onClose}><span />{category}</Link>)}</nav>
    <div className="side-bottom">
      <div className="promo"><Gift /><strong>Build a sharper prompt stack.</strong><p>Curated tools from proven creators.</p></div>
      <Link to="/" search={{ free: true }} className="side-cta" onClick={onClose}>Explore free prompts<ChevronRight /></Link>
      <div className="side-legal"><span>© 2026</span><a href="mailto:hello@powerprompt.local">Support</a></div>
    </div>
  </aside>
}
