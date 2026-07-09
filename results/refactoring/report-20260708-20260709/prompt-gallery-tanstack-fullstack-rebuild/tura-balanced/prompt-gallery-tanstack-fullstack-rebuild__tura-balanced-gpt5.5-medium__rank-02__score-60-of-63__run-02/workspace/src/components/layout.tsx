"use client"

import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { BoltIcon, Icon } from './icons'

export function Shell({ children, categories = [], cartCount = 0, onSearchToggle }: { children: React.ReactNode; categories?: { id: string; label: string }[]; cartCount?: number; onSearchToggle?: () => void }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const close = () => setOpen(false)

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Marketplace navigation">
        <Link to="/" className="logo" onClick={close}>
          <span className="bolt"><BoltIcon /></span><b>POWERPROMPT</b><span>Gallery</span>
        </Link>
        <Link className="navi active" to="/" onClick={close}><Icon name="home" /> Home</Link>
        <button className="navi" onClick={() => { onSearchToggle?.(); close() }}><Icon name="search" /> Search</button>
        <button className="navi" onClick={() => close()}><Icon name="clock" /> History</button>
        <Link className="navi" to="/" search={{ favorites: true }} onClick={close}><Icon name="heart" /> Favorites <span className="new">NEW</span></Link>

        <div className="side-label">Categories</div>
        {categories.map((category) => (
          <Link key={category.id} to="/" search={{ category: category.id }} className="cat" onClick={close}><span className="dot" />{category.label}</Link>
        ))}

        <div className="side-label">More from us</div>
        <button className="navi"><Icon name="ext" /> Browser extension</button>
        <button className="navi"><Icon name="figma" /> Figma plugin</button>
        <Link className="navi" to="/admin"><Icon name="api" /> Public API</Link>

        <div className="side-foot">
          <div className="promo-card">
            <Icon name="bag" />
            <h4>Sell your prompts</h4>
            <p>Keep 85% of every sale — paid weekly.</p>
          </div>
          <div className="side-cta">
            <Link className="btn-ink" to="/admin">Get started</Link>
            <Link className="free-link" to="/" search={{ free: true }}>Free prompts</Link>
          </div>
          <div className="side-legal">
            <span>Terms</span> · <span>Privacy</span> · <span>Refund</span>
            <span className="stars"><Icon name="star" /> 4.8</span>
          </div>
        </div>
      </aside>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={close} />
      <main className="main">
        <div className="mtop">
          <button className="burger" aria-label="Menu" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <span className="bolt"><BoltIcon /></span><b>POWERPROMPT</b>
        </div>
        {children}
      </main>
      <nav className="dock" aria-label="Quick actions">
        <Link to="/" className="active" aria-label="Home"><Icon name="home" /></Link>
        <Link to="/" search={{ favorites: true }} aria-label="Favorites"><Icon name="heart" /></Link>
        <button aria-label="History"><Icon name="clock" /></button>
        <Link to="/admin" aria-label="Creator analytics"><Icon name="spark" /></Link>
        <Link to="/cart" aria-label="Cart"><Icon name="cart" />{cartCount > 0 && <span className="cbadge">{cartCount}</span>}</Link>
      </nav>
    </div>
  )
}

export function Toast({ message }: { message: string }) {
  return <div className={`toast ${message ? 'show' : ''}`} role="status"><span className="d" />{message || 'Ready'}</div>
}
