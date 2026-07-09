import { Link } from '@tanstack/react-router'
import { Icons } from './icons'

export function Sidebar({
  categories,
  activeCategory,
  favoritesCount,
  isOpen,
  onClose,
  onCategory,
  onFavorites,
  onSearch,
  onFree,
}: {
  categories: Array<{ category: string; count: number }>
  activeCategory: string
  favoritesCount: number
  isOpen: boolean
  onClose: () => void
  onCategory: (category: string) => void
  onFavorites: () => void
  onSearch: () => void
  onFree: () => void
}) {
  return (
    <>
      <aside className={`sidebar ${isOpen ? 'open' : ''}`} aria-label="Sidebar">
        <Link to="/" className="logo" onClick={onClose}>
          <span className="bolt">
            <Icons.Zap fill="currentColor" />
          </span>
          <b>POWERPROMPT</b>
          <span>Gallery</span>
        </Link>

        <Link to="/" className="navi active" onClick={onClose}>
          <Icons.Home /> Home
        </Link>
        <button className="navi" onClick={onSearch}>
          <Icons.Search /> Search
        </button>
        <button className="navi" onClick={() => undefined}>
          <Icons.Clock3 /> History
        </button>
        <button className="navi" onClick={onFavorites}>
          <Icons.Heart /> Favorites <span className="new">{favoritesCount}</span>
        </button>

        <div className="side-label">Categories</div>
        <div className="cat-list">
          {categories.map((item) => (
            <button
              className={`cat ${activeCategory === item.category ? 'active' : ''}`}
              key={item.category}
              onClick={() => onCategory(item.category)}
            >
              <span className="dot" />
              <span>{item.category}</span>
              <span className="cat-count">{item.count}</span>
            </button>
          ))}
        </div>

        <div className="side-label">More from us</div>
        <Link to="/creator" className="navi" onClick={onClose}>
          <Icons.BarChart3 /> Creator analytics
        </Link>
        <button className="navi" onClick={() => undefined}>
          <Icons.Code2 /> Public API
        </button>
        <button className="navi" onClick={() => undefined}>
          <Icons.Boxes /> Figma plugin
        </button>

        <div className="side-foot">
          <div className="promo-card">
            <Icons.Sparkles className="gift" />
            <h4>Sell your prompts</h4>
            <p>Keep 85% of every sale, paid weekly.</p>
          </div>
          <div className="side-cta">
            <Link to="/creator" className="btn-ink" onClick={onClose}>
              Get started
            </Link>
            <button className="free" onClick={onFree}>
              Free prompts
            </button>
          </div>
          <div className="side-legal">
            <span>Terms</span> · <span>Privacy</span> · <span>Refund</span>
            <span className="stars">
              <Icons.Star fill="currentColor" /> 4.8
            </span>
          </div>
        </div>
      </aside>
      <button
        className={`scrim ${isOpen ? 'show' : ''}`}
        aria-label="Close navigation"
        onClick={onClose}
      />
    </>
  )
}
