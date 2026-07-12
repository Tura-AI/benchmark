import { Link, useNavigate } from '@tanstack/react-router'
import type { CartSummary } from '~/data/schema'

const nav = [{ label: 'Home', to: '/' }, { label: 'Search' }, { label: 'Favorites', to: '/favorites' }, { label: 'Cart', to: '/cart' }, { label: 'Analytics', to: '/admin' }] as const
const cats = ['Image','Photography','Design','Writing','Code','Marketing','Productivity','Research']

export function Sidebar({ counts, open, onClose, onSearch }: { counts?: { favorites: number; cart: number }; open: boolean; onClose: () => void; onSearch: () => void }) {
  return <>
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Marketplace navigation">
      <Link to="/" search={{ category: 'All' }} className="logo" onClick={onClose}><span className="bolt">P</span><b>POWER</b><span>PROMPT</span></Link>
      <nav>{nav.map((item) => !('to' in item) ? <button key={item.label} className="navi" onClick={() => { onSearch(); onClose() }}>Search</button> : <Link key={item.label} className="navi" to={item.to} search={item.to === '/' ? { category: 'All' } : undefined}>{item.label}{item.label === 'Favorites' && counts?.favorites ? <em>{counts.favorites}</em> : null}{item.label === 'Cart' && counts?.cart ? <em>{counts.cart}</em> : null}</Link>)}</nav>
      <p className="side-label">Categories</p>
      <div>{cats.map((cat) => <Link className="cat" key={cat} to="/" search={{ category: cat } as any} onClick={onClose}><i />{cat}</Link>)}</div>
      <div className="side-foot"><div className="promo-card"><h4>Creator drop: 20% off prompt packs</h4><p>Featured bundles refresh every Friday.</p></div><Link className="btn-ink" to="/checkout">Checkout</Link></div>
    </aside>
    <button className={`scrim ${open ? 'show' : ''}`} aria-label="Close menu" onClick={onClose} />
  </>
}

export function Dock({ cart }: { cart?: CartSummary }) {
  return <div className="dock" aria-label="Quick actions"><Link to="/" search={{ category: 'All' }}>Home</Link><Link to="/favorites">Favorites</Link><Link to="/cart">Cart{cart?.items.length ? <b>{cart.items.length}</b> : null}</Link><Link to="/admin">Analytics</Link></div>
}

export function Topbar({ searchOpen, setSearchOpen, term, setTerm, model, setModel, sort, setSort }: any) {
  const models = ['All','GPT-4o','Claude','Midjourney','Flux']
  return <header className="topbar"><div className="filterbar"><div className="ftabs">{models.map((m) => <button className={model === m ? 'active' : ''} key={m} onClick={() => setModel(m)}>{m}</button>)}</div><div className="fsort">{['Featured','Newest','Popular'].map((s) => <button className={sort === s ? 'active' : ''} key={s} onClick={() => setSort(s)}>{s}</button>)}<button onClick={() => setSearchOpen(!searchOpen)}>Search</button></div></div><div className={`searchbar ${searchOpen ? 'open' : ''}`}><label><span>Search prompts</span><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Portrait, code review, memo..." /></label></div></header>
}

export function MobileTop({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate()
  return <div className="mobile-top"><button onClick={onMenu} aria-label="Open menu">Menu</button><button onClick={() => navigate({ to: '/cart' })}>Cart</button></div>
}
