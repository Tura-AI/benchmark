import { Link, Outlet, useLoaderData, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Boxes,
  Clock3,
  Code2,
  Gift,
  Heart,
  Home,
  LayoutGrid,
  Menu,
  Plug,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  X,
} from 'lucide-react'
import { useState } from 'react'
import type { ShellData } from '../types'
import { BoltIcon } from './icons'
import { ToastProvider, useToast } from './Toast'

export function AppShell() {
  return (
    <ToastProvider>
      <ShellFrame />
    </ToastProvider>
  )
}

function ShellFrame() {
  const shell = useLoaderData({ from: '__root__' }) as ShellData
  const [drawer, setDrawer] = useState(false)
  const state = useRouterState()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const active = state.location.pathname

  const goFiltered = (next: Record<string, string | boolean | undefined>) => {
    setDrawer(false)
    navigate({ to: '/', search: (prev: any) => ({ ...prev, ...next }) })
  }

  return (
    <>
      <aside className={`sidebar ${drawer ? 'open' : ''}`} aria-label="Marketplace navigation">
        <div className="logo">
          <BoltIcon />
          <b>POWERPROMPT</b>
          <span>Gallery</span>
        </div>

        <Link className={`navi ${active === '/' ? 'active' : ''}`} to="/">
          <Home /> Home
        </Link>
        <button className="navi" onClick={() => goFiltered({ searchOpen: true })}>
          <Search /> Search
        </button>
        <button className="navi" onClick={() => showToast('History is empty for now')}>
          <Clock3 /> History
        </button>
        <button className="navi" onClick={() => goFiltered({ favorites: true, model: 'all', category: 'all' })}>
          <Heart /> Favorites <span className="new">NEW</span>
        </button>

        <div className="side-label">Categories</div>
        <div className="cats">
          {shell.categories.map((category) => (
            <button key={category.name} className="cat" onClick={() => goFiltered({ category: category.name, favorites: false })}>
              <span className="dot" />
              {category.name}
              <span className="count">{category.promptCount}</span>
            </button>
          ))}
        </div>

        <div className="side-label">More from us</div>
        <button className="navi" onClick={() => showToast('Browser extension - coming soon')}>
          <Plug /> Browser extension
        </button>
        <button className="navi" onClick={() => showToast('Figma plugin - coming soon')}>
          <Boxes /> Figma plugin
        </button>
        <button className="navi" onClick={() => showToast('API docs - coming soon')}>
          <Code2 /> Public API
        </button>

        <div className="side-foot">
          <div className="promo-card">
            <Gift className="gift" />
            <h4>Sell your prompts</h4>
            <p>Keep 85% of every sale - paid weekly.</p>
          </div>
          <div className="side-cta">
            <Link className="btn-ink" to="/admin">
              Creator hub
            </Link>
            <button className="free" onClick={() => goFiltered({ freeOnly: true, favorites: false })}>
              Free prompts
            </button>
          </div>
          <div className="side-legal">
            <span>Terms</span> · <span>Privacy</span> · <span>Refund</span>
            <span className="stars">
              <Star /> 4.8
            </span>
          </div>
        </div>
      </aside>

      <div className={`scrim ${drawer ? 'show' : ''}`} onClick={() => setDrawer(false)} />

      <main className="main">
        <div className="mtop">
          <button className="burger" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Menu />
          </button>
          <BoltIcon />
          <b>POWERPROMPT</b>
        </div>
        <Outlet />
      </main>

      <nav className="dock" aria-label="Quick actions">
        <Link to="/" className={active === '/' ? 'active' : ''} aria-label="Home">
          <Home />
        </Link>
        <button aria-label="History" onClick={() => showToast('History is empty for now')}>
          <Clock3 />
        </button>
        <button aria-label="Favorites" onClick={() => goFiltered({ favorites: true, model: 'all', category: 'all' })}>
          <Heart />
        </button>
        <Link to="/admin" className={active === '/admin' ? 'active' : ''} aria-label="Creator analytics">
          <LayoutGrid />
        </Link>
        <Link to="/cart" className={active === '/cart' ? 'active' : ''} aria-label="Cart">
          <ShoppingBag />
          <span className={`cbadge ${shell.counts.cart ? 'show' : ''}`}>{shell.counts.cart}</span>
        </Link>
        <button aria-label="Generate" onClick={() => showToast('In-app generation - coming soon')}>
          <Sparkles />
        </button>
      </nav>
    </>
  )
}
