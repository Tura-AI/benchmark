import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import '../styles.css'

function Root() {
  return <RootDocument><Outlet /></RootDocument>
}
function RootDocument({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><HeadContent /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>POWERPROMPT</title></head><body>{children}<Scripts /></body></html>
}
export function Sidebar({ open, onClose, categories = [], counts }: { open?: boolean; onClose?: () => void; categories?: any[]; counts?: any }) {
  return <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Marketplace navigation">
    <Link to="/" className="brand" onClick={onClose}><span className="mark">P</span><span><span className="word">POWERPROMPT</span><br /><span className="sub mono">Prompt gallery</span></span></Link>
    <nav className="side-section"><div className="side-title mono">Browse</div><Link className="navbtn active" to="/" onClick={onClose}>Home <span className="pill">{counts?.total ?? 12}</span></Link><Link className="navbtn" to="/" search={{ favorites: true }} onClick={onClose}>Favorites <span className="pill">{counts?.favorites ?? 0}</span></Link><Link className="navbtn" to="/cart" onClick={onClose}>Cart <span className="pill">{counts?.cart ?? 0}</span></Link><Link className="navbtn" to="/admin" onClick={onClose}>Creator analytics</Link></nav>
    <div className="side-section"><div className="side-title mono">Categories</div>{categories.map((c) => <Link key={c.id} className="catbtn" to="/" search={{ category: c.id }} onClick={onClose}>{c.name}<span className="pill">{c.count}</span></Link>)}</div>
    <section className="cta"><h2>Build reusable image systems.</h2><p>Featured and free prompt packs for GPT-4o, Claude, Midjourney, and Flux.</p><Link className="lime" to="/" search={{ free: true }}>Get free prompts</Link></section>
  </aside>
}
export function Dock() { return <nav className="dock" aria-label="Mobile actions"><Link to="/">Home</Link><Link to="/" search={{ favorites: true }}>Favorites</Link><Link to="/cart">Cart</Link><Link to="/admin">Stats</Link></nav> }
export const Route = createRootRoute({ component: Root })
export const rootRoute = Route
