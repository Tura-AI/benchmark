import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { BarChart3,Bolt,Clock3,Heart,Home,Menu,Search,ShoppingBag,Sparkles,X } from './Icons'

interface Props{children:ReactNode;cartCount?:number;categories?:{name:string,count:number}[];active?:string}
export function AppShell({children,cartCount=0,categories=[],active='home'}:Props){
  const [drawer,setDrawer]=useState(false)
  const close=()=>setDrawer(false)
  return <div className="app-shell">
    <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={()=>setDrawer(true)}><Menu/></button>
    <div className={`scrim ${drawer?'show':''}`} onClick={close}/>
    <aside className={`sidebar ${drawer?'open':''}`} aria-label="Primary navigation">
      <div className="brand-row"><Link to="/" className="brand" onClick={close}><span className="brand-bolt"><Bolt/></span><strong>POWER</strong><em>PROMPT</em></Link><button className="drawer-close icon-button" aria-label="Close navigation" onClick={close}><X/></button></div>
      <nav className="primary-nav">
        <Link to="/" search={{}} activeOptions={{exact:true}} className={`nav-link ${active==='home'?'selected':''}`} onClick={close}><Home/>Home</Link>
        <Link to="/" search={{favorites:true}} className={`nav-link ${active==='favorites'?'selected':''}`} onClick={close}><Heart/>Favorites</Link>
        <Link to="/" search={{q:''}} className="nav-link" onClick={close}><Search/>Search</Link>
        <button className="nav-link" onClick={()=>{close();window.dispatchEvent(new CustomEvent('powerprompt-toast',{detail:'History is empty for now'}))}}><Clock3/>History</button>
      </nav>
      {categories.length>0&&<><p className="side-label">Explore</p><nav className="category-nav"><Link to="/" search={{}} className="category-link" onClick={close}><span/>All prompts</Link>{categories.map(c=><Link key={c.name} to="/" search={{category:c.name}} className="category-link" onClick={close}><span/>{c.name}<small>{c.count}</small></Link>)}</nav></>}
      <div className="side-bottom">
        <div className="promo"><Sparkles/><strong>Build a better prompt stack</strong><span>Curated tools. Lifetime access.</span></div>
        <Link to="/analytics" className="nav-link" onClick={close}><BarChart3/>Creator analytics</Link>
        <p className="legal">© 2026 POWERPROMPT · Terms · Privacy</p>
      </div>
    </aside>
    <main className="main">{children}</main>
    <nav className="mobile-dock" aria-label="Mobile navigation">
      <Link to="/" search={{}}><Home/><span>Home</span></Link><Link to="/" search={{favorites:true}}><Heart/><span>Favorites</span></Link><Link to="/" search={{q:''}}><Search/><span>Search</span></Link><Link to="/cart" className="dock-cart"><ShoppingBag/><span>Cart</span>{cartCount>0&&<b>{cartCount}</b>}</Link>
    </nav>
  </div>
}
