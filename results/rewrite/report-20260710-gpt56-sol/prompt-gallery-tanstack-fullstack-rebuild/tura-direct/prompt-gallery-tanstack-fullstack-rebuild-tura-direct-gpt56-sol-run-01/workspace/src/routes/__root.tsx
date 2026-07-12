import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { Menu, ShoppingBag, Zap } from 'lucide-react'
import { useState } from 'react'
import { AppProvider, useApp } from '../ui/AppContext'
import { Sidebar } from '../ui/Sidebar'
import '../styles.css'

export const Route = createRootRoute({
  head: () => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'POWERPROMPT — Prompt marketplace' }], links: [{ rel: 'icon', href: 'data:,' }] }),
  component: Root,
})

function Root() {
  return <html lang="en"><head><HeadContent /></head><body><AppProvider><Shell /></AppProvider><Scripts /></body></html>
}

function Shell() {
  const [drawer, setDrawer] = useState(false)
  const { cartCount } = useApp()
  return <div className="app-shell">
    <Sidebar open={drawer} onClose={() => setDrawer(false)} />
    {drawer && <button className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}
    <div className="app-main">
      <header className="mobile-head"><button className="icon-button" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu /></button><Link to="/" className="mobile-brand"><span><Zap /></span>POWERPROMPT</Link><Link to="/cart" className="icon-button badge-wrap" aria-label={`Cart, ${cartCount} items`}><ShoppingBag />{cartCount > 0 && <b>{cartCount}</b>}</Link></header>
      <Outlet />
    </div>
  </div>
}
