import { Link, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { Icons } from './icons'

type Category = { name: string; count: number }

export function Chrome({
  children,
  categories,
  cartCount,
}: {
  children: React.ReactNode
  categories: Category[]
  cartCount: number
}) {
  const [drawer, setDrawer] = useState(false)
  const path = useRouterState({ select: (s) => s.location.pathname })
  return (
    <div className="shell">
      <aside className={`sidebar ${drawer ? 'open' : ''}`} id="sidebar">
        <Link to="/" className="logo" onClick={() => setDrawer(false)}>
          <span className="bolt"><Icons.Bolt /></span>
          <b>POWERPROMPT</b><span>Gallery</span>
        </Link>
        <Link className={`nav-item ${path === '/' ? 'active' : ''}`} to="/" onClick={() => setDrawer(false)}><Icons.Home />Home</Link>
        <Link className="nav-item" to="/" search={{ searchOpen: true }} onClick={() => setDrawer(false)}><Icons.Search />Search</Link>
        <button className="nav-item" type="button"><Icons.Clock3 />History</button>
        <Link className={`nav-item ${path === '/' ? '' : ''}`} to="/" search={{ favoritesOnly: true }} onClick={() => setDrawer(false)}><Icons.Heart />Favorites <span className="new-pill">NEW</span></Link>

        <div className="side-label">Categories</div>
        {categories.map((category) => (
          <Link key={category.name} className="cat" to="/" search={{ category: category.name }} onClick={() => setDrawer(false)}>
            <span className="dot" />{category.name}
          </Link>
        ))}

        <div className="side-label">More from us</div>
        <Link className="nav-item" to="/admin"><Icons.PackageSearch />Creator analytics</Link>
        <button className="nav-item" type="button"><Icons.Box />Browser extension</button>
        <button className="nav-item" type="button"><Icons.Code2 />Public API</button>

        <div className="side-foot">
          <div className="promo-card">
            <Icons.Gift />
            <h4>Sell your prompts</h4>
            <p>Keep 85% of every sale, paid weekly.</p>
          </div>
          <div className="side-cta">
            <Link className="btn-ink" to="/admin">Get started</Link>
            <Link className="free-link" to="/" search={{ freeOnly: true }}>Free prompts</Link>
          </div>
          <div className="side-legal">
            <span>Terms</span> · <span>Privacy</span> · <span>Refund</span>
            <span className="stars">★ 4.8</span>
          </div>
        </div>
      </aside>
      <div className={`scrim ${drawer ? 'show' : ''}`} onClick={() => setDrawer(false)} />
      <main className="main">
        <div className="mobile-top">
          <button className="burger" aria-label="Menu" onClick={() => setDrawer(true)}><Icons.Menu /></button>
          <span className="bolt"><Icons.Bolt /></span>
          <b>POWERPROMPT</b>
        </div>
        {children}
      </main>
      <nav className="dock" aria-label="Quick actions">
        <Link to="/" className={path === '/' ? 'active' : ''} aria-label="Home"><Icons.Home /></Link>
        <button aria-label="History"><Icons.Clock3 /></button>
        <Link to="/" search={{ favoritesOnly: true }} aria-label="Favorites"><Icons.Heart /></Link>
        <Link to="/admin" aria-label="Collections"><Icons.Grid2X2 /></Link>
        <Link to="/cart" className={path === '/cart' ? 'active' : ''} aria-label="Cart">
          <Icons.ShoppingBag />
          {cartCount > 0 ? <span className="badge">{cartCount}</span> : null}
        </Link>
        <button aria-label="Generate"><Icons.Sparkles /></button>
      </nav>
    </div>
  )
}
