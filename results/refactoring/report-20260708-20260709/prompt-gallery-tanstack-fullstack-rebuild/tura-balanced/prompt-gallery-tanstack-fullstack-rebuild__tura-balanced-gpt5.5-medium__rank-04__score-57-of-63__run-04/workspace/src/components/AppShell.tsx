import { Link } from '@tanstack/react-router'
import { Icons } from './icons'

type Props = {
  categories: Array<{ name: string }>
  cartCount: number
  active?: string
  onSearch?: () => void
  onCategory?: (category: string) => void
  onFavorites?: () => void
}

export function AppShell({ categories, cartCount, active = 'home', onSearch, onCategory, onFavorites }: Props) {
  return (
    <>
      <aside className="sidebar" id="sidebar">
        <Link className="logo" to="/" aria-label="POWERPROMPT Gallery home">
          <span className="bolt"><Icons.Zap size={16} fill="currentColor" /></span>
          <b>POWERPROMPT</b><span>Gallery</span>
        </Link>
        <Link className={`navi ${active === 'home' ? 'active' : ''}`} to="/"><Icons.Home /> Home</Link>
        <button className="navi" onClick={onSearch} type="button"><Icons.Search /> Search</button>
        <button className="navi" type="button"><Icons.History /> History</button>
        <button className={`navi ${active === 'favorites' ? 'active' : ''}`} onClick={onFavorites} type="button"><Icons.Heart /> Favorites <span className="new">NEW</span></button>
        <div className="side-label">Categories</div>
        <div>
          {categories.map((category) => <button className="cat" key={category.name} onClick={() => onCategory?.(category.name)} type="button"><span className="dot" />{category.name}</button>)}
        </div>
        <div className="side-label">More from us</div>
        <Link className="navi" to="/admin"><Icons.BarChart3 /> Creator analytics</Link>
        <button className="navi" type="button"><Icons.Compass /> Browser extension</button>
        <button className="navi" type="button"><Icons.Boxes /> Figma plugin</button>
        <button className="navi" type="button"><Icons.Code2 /> Public API</button>
        <div className="side-foot">
          <div className="promo-card"><Icons.Sparkles className="gift" /><h4>Publish a prompt pack</h4><p>Earn on reusable model workflows.</p></div>
          <div className="side-cta"><Link className="btn-ink" to="/cart">Cart</Link><span className="free">{cartCount} saved</span></div>
        </div>
      </aside>
      <nav className="dock" aria-label="Mobile dock">
        <Link to="/" className={active === 'home' ? 'active' : ''} aria-label="Home"><Icons.Home /></Link>
        <button aria-label="History" type="button"><Icons.History /></button>
        <button aria-label="Favorites" type="button" onClick={onFavorites}><Icons.Heart /></button>
        <Link to="/admin" aria-label="Analytics"><Icons.BarChart3 /></Link>
        <Link to="/cart" aria-label="Cart"><Icons.ShoppingBag /><span className={`cbadge ${cartCount ? 'show' : ''}`}>{cartCount}</span></Link>
        <button aria-label="Generate" type="button"><Icons.Wand2 /></button>
      </nav>
    </>
  )
}
