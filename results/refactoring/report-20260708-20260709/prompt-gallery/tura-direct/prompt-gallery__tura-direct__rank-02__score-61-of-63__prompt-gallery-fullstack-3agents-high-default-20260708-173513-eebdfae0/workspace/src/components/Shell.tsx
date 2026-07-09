import { Link, Outlet, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getCartState } from '../server/functions'

export function Shell() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const close = () => setOpen(false)
  return <div className="app">
    <div className={`drawer-scrim ${open ? 'show' : ''}`} onClick={close} />
    <aside id="mobile-sidebar" className={`sidebar ${open ? 'open' : ''}`} aria-label="POWERPROMPT navigation">
      <Link to="/" className="logo" onClick={close}><span className="bolt">P</span><b>POWER</b><span>PROMPT</span></Link>
      <Link className="navi active" to="/" search={{}}>Home</Link>
      <Link className="navi" to="/" search={{ favoritesOnly: true }}>Favorites <span className="pill">Saved</span></Link>
      <Link className="navi" to="/cart">Cart</Link>
      <Link className="navi" to="/admin/analytics">Creator analytics</Link>
      <button className="navi" onClick={() => router.invalidate()}>Search history</button>
      <p className="side-label mono">Categories</p>
      {['Makeup','Fashion','Product','Portrait','Video'].map((name) => <Link key={name} className="cat" to="/" search={{ category: name.toLowerCase() }} onClick={close}><span className="dot" />{name}</Link>)}
      <div className="promo-card"><h4>Creator drop: 16 prompt systems</h4><p>Featured beauty workflows with checkout-ready licensing.</p></div>
    </aside>
    <main className="main">
      <div className="mobilebar"><Link to="/" className="logo"><span className="bolt">P</span><b>POWER</b><span>PROMPT</span></Link><button aria-controls="mobile-sidebar" aria-expanded={open} onClick={() => setOpen(true)}>Menu</button></div>
      <Outlet />
      <Dock />
    </main>
  </div>
}

function Dock() {
  const [notice, setNotice] = useState('')
  return <>
    <nav className="dock" aria-label="Quick actions">
      <Link to="/" search={{}}>Home</Link>
      <Link to="/" search={{ favoritesOnly: true }}>Favorites</Link>
      <Link to="/cart">Cart</Link>
      <Link to="/admin/analytics">Creator analytics</Link>
      <button onClick={async () => { const cart = await getCartState(); setNotice(`${(cart as any).totals.itemCount} prompt(s) in Cart`) }}>Dock</button>
    </nav>
    {notice ? <div role="status" className="toast" onAnimationEnd={() => setNotice('')}>{notice}</div> : null}
  </>
}
