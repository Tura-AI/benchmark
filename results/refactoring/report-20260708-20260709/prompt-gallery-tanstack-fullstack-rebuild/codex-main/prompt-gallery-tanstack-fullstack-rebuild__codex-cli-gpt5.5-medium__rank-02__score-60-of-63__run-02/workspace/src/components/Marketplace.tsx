import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Bolt, Icon } from './Icons'
import type { CatalogResult, Prompt, SortKey } from '../server/db.server'

type View = 'home' | 'favorites'

const models = ['all', 'GPT-4o', 'Claude', 'Midjourney', 'Flux']
const sorts: Array<{ key: SortKey; label: string }> = [
  { key: 'featured', label: 'Featured' },
  { key: 'newest', label: 'Newest' },
  { key: 'popular', label: 'Popular' },
]

export function Marketplace({ initial }: { initial: CatalogResult }) {
  const router = useRouter()
  const [catalog, setCatalog] = useState(initial)
  const [model, setModel] = useState('all')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<SortKey>('featured')
  const [term, setTerm] = useState('')
  const [view, setView] = useState<View>('home')
  const [searchOpen, setSearchOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [preview, setPreview] = useState<Prompt | null>(null)
  const [columnCount, setColumnCount] = useState(4)

  const columns = useMemo(() => distribute(catalog.prompts, columnCount), [catalog.prompts, columnCount])

  useEffect(() => {
    const listener = (event: Event) => notify((event as CustomEvent<string>).detail)
    window.addEventListener('pp-toast', listener)
    return () => window.removeEventListener('pp-toast', listener)
  }, [])

  useEffect(() => {
    const sync = () => setColumnCount(window.innerWidth < 640 ? 2 : window.innerWidth < 1100 ? 3 : 4)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  async function refresh(next = { model, category, sort, term, view }) {
    const params = new URLSearchParams()
    if (next.model !== 'all') params.set('model', next.model)
    if (next.category !== 'all') params.set('category', next.category)
    if (next.sort) params.set('sort', next.sort)
    if (next.term) params.set('term', next.term)
    if (next.view === 'favorites') params.set('favorites', 'true')
    const res = await fetch(`/api/catalog?${params}`)
    setCatalog(await res.json())
  }

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  async function changeFilter(next: Partial<{ model: string; category: string; sort: SortKey; term: string; view: View }>) {
    const merged = { model, category, sort, term, view, ...next }
    setModel(merged.model)
    setCategory(merged.category)
    setSort(merged.sort)
    setTerm(merged.term)
    setView(merged.view)
    await refresh(merged)
  }

  async function toggleFavorite(prompt: Prompt) {
    const res = await fetch('/api/favorite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ promptId: prompt.id }),
    })
    const data = await res.json()
    notify(data.favorite ? 'Saved to Favorites' : 'Removed from Favorites')
    await refresh()
    router.invalidate()
  }

  async function add(prompt: Prompt) {
    const res = await fetch('/api/cart', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'add', promptId: prompt.id }),
    })
    const data = await res.json()
    setCatalog((current) => ({ ...current, counts: { ...current.counts, cart: data.items.length } }))
    notify(`Added - ${prompt.title}`)
  }

  return (
    <>
      <Sidebar
        catalog={catalog}
        category={category}
        view={view}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onHome={() => changeFilter({ model: 'all', category: 'all', view: 'home', term: '' })}
        onSearch={() => setSearchOpen((value) => !value)}
        onFavorites={() => changeFilter({ model: 'all', category: 'all', view: 'favorites' })}
        onCategory={(name) => changeFilter({ category: name, view: 'home' })}
        onFree={() => changeFilter({ model: 'all', category: 'all', view: 'home', term: '', sort: 'featured' }).then(() => notify('Free prompts highlighted in the catalog'))}
      />
      <main className="main">
        <MobileTop onMenu={() => setDrawerOpen(true)} />
        <TopFilters
          model={model}
          sort={sort}
          searchOpen={searchOpen}
          term={term}
          onModel={(value) => changeFilter({ model: value })}
          onSort={(value) => changeFilter({ sort: value })}
          onTerm={(value) => changeFilter({ term: value })}
        />
        <section className="gallery" aria-label="Prompt gallery">
          {catalog.prompts.length === 0 ? (
            <div className="empty">
              <div className="big">Nothing here yet</div>
              <div>{view === 'favorites' ? 'Tap the bookmark on any prompt to save it.' : 'Try a different filter or search.'}</div>
            </div>
          ) : (
            <div className="masonry">
              {columns.map((col, index) => (
                <div className="ms-col" key={index}>
                  {col.map((prompt) => (
                    <PromptCard key={prompt.id} prompt={prompt} onAdd={add} onFavorite={toggleFavorite} onPreview={setPreview} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <Dock cartCount={catalog.counts.cart} view={view} onHome={() => changeFilter({ model: 'all', category: 'all', view: 'home', term: '' })} onFavorites={() => changeFilter({ view: 'favorites' })} notify={notify} />
      {preview ? <Lightbox prompt={preview} onAdd={add} onClose={() => setPreview(null)} /> : null}
      <div className={`toast ${toast ? 'show' : ''}`} role="status"><span className="d" />{toast}</div>
      <button className={`scrim ${drawerOpen ? 'show' : ''}`} aria-label="Close menu" onClick={() => setDrawerOpen(false)} />
    </>
  )
}

function Sidebar(props: {
  catalog: CatalogResult
  category: string
  view: View
  open: boolean
  onClose: () => void
  onHome: () => void
  onSearch: () => void
  onFavorites: () => void
  onCategory: (name: string) => void
  onFree: () => void
}) {
  return (
    <aside className={`sidebar ${props.open ? 'open' : ''}`}>
      <div className="logo">
        <span className="bolt"><Bolt /></span>
        <b>POWERPROMPT</b><span>Gallery</span>
      </div>
      <NavButton active={props.view === 'home'} icon="home" onClick={() => { props.onHome(); props.onClose() }}>Home</NavButton>
      <NavButton icon="search" onClick={props.onSearch}>Search</NavButton>
      <NavButton icon="history" onClick={() => toastOnly('History is empty for now')}>History</NavButton>
      <NavButton active={props.view === 'favorites'} icon="heart" badge="NEW" onClick={() => { props.onFavorites(); props.onClose() }}>Favorites</NavButton>
      <div className="side-label">Categories</div>
      {props.catalog.categories.map((cat) => (
        <button key={cat.name} className={`cat ${props.category === cat.name ? 'active' : ''}`} onClick={() => { props.onCategory(cat.name); props.onClose() }}>
          <span className="dot" />{cat.name}<span className="cat-count">{cat.count}</span>
        </button>
      ))}
      <div className="side-label">More from us</div>
      <NavButton icon="grid" onClick={() => toastOnly('Browser extension - coming soon')}>Browser extension</NavButton>
      <NavButton icon="spark" onClick={() => toastOnly('Figma plugin - coming soon')}>Figma plugin</NavButton>
      <NavButton icon="api" onClick={() => toastOnly('API docs - coming soon')}>Public API</NavButton>
      <div className="side-foot">
        <div className="promo-card">
          <Icon name="bag" />
          <h4>Sell your prompts</h4>
          <p>Keep 85% of every sale - paid weekly.</p>
        </div>
        <div className="side-cta">
          <Link className="btn-ink" to="/admin">Creator admin</Link>
          <button className="free" onClick={props.onFree}>Free prompts</button>
        </div>
        <div className="side-legal"><a>Terms</a> · <a>Privacy</a> · <a>Refund</a><span className="stars">★ 4.8</span></div>
      </div>
    </aside>
  )
}

function NavButton({ active, icon, badge, onClick, children }: { active?: boolean; icon: string; badge?: string; onClick: () => void; children: React.ReactNode }) {
  return <button className={`navi ${active ? 'active' : ''}`} onClick={onClick}><Icon name={icon} />{children}{badge ? <span className="new">{badge}</span> : null}</button>
}

function TopFilters({ model, sort, searchOpen, term, onModel, onSort, onTerm }: {
  model: string
  sort: SortKey
  searchOpen: boolean
  term: string
  onModel: (value: string) => void
  onSort: (value: SortKey) => void
  onTerm: (value: string) => void
}) {
  return (
    <div className="topbar">
      <div className="filterbar">
        <div className="ftabs">
          {models.map((item) => (
            <button key={item} className={`ftab ${model === item ? 'active' : ''}`} onClick={() => onModel(item)}>
              <Icon name={item === 'Flux' ? 'flux' : item === 'Midjourney' ? 'image' : item === 'all' ? 'grid' : 'circle'} />{item === 'all' ? 'All' : item}
            </button>
          ))}
        </div>
        <div className="fsort">
          {sorts.map((item) => <button key={item.key} className={`sortbtn ${sort === item.key ? 'active' : ''}`} onClick={() => onSort(item.key)}>{item.label}</button>)}
        </div>
      </div>
      <div className={`searchbar ${searchOpen ? 'open' : ''}`}>
        <div className="inner">
          <Icon name="search" />
          <input value={term} onChange={(event) => onTerm(event.target.value)} placeholder="Search prompts - portrait, poster, cold email..." />
        </div>
      </div>
    </div>
  )
}

function MobileTop({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="mtop">
      <button className="burger" aria-label="Menu" onClick={onMenu}><Icon name="menu" /></button>
      <span className="bolt"><Bolt /></span>
      <b>POWERPROMPT</b>
    </div>
  )
}

function PromptCard({ prompt, onAdd, onFavorite, onPreview }: { prompt: Prompt; onAdd: (prompt: Prompt) => void; onFavorite: (prompt: Prompt) => void; onPreview: (prompt: Prompt) => void }) {
  return (
    <article className={`tile ${prompt.isFavorite ? 'saved' : ''}`} style={{ ['--ar' as string]: prompt.aspectRatio }}>
      <button className="savedmark" aria-label="Saved" onClick={() => onFavorite(prompt)}><Icon name="bookmark" /></button>
      <button className="media" onClick={() => onPreview(prompt)} aria-label={`Preview ${prompt.title}`}>
        <img src={prompt.imageUrl} alt={prompt.title} loading="lazy" />
      </button>
      <div className="ov">
        <div className="ov__top">
          <span className="model">{prompt.model}</span>
          <button className={`bm ${prompt.isFavorite ? 'on' : ''}`} aria-label="Save" onClick={() => onFavorite(prompt)}><Icon name="bookmark" /></button>
        </div>
        <div>
          <button className="tile-title" onClick={() => onPreview(prompt)}>{prompt.title}</button>
          <div className="ov__row">
            <span className={`price ${prompt.price === 0 ? 'free' : ''}`}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</span>
            <button className="add" onClick={() => onAdd(prompt)}>Add <Icon name="plus" /></button>
          </div>
        </div>
      </div>
    </article>
  )
}

function Dock({ cartCount, view, onHome, onFavorites, notify }: { cartCount: number; view: View; onHome: () => void; onFavorites: () => void; notify: (message: string) => void }) {
  return (
    <nav className="dock" aria-label="Quick actions">
      <button className={view === 'home' ? 'active' : ''} aria-label="Home" onClick={onHome}><Icon name="home" /></button>
      <button aria-label="History" onClick={() => notify('History is empty for now')}><Icon name="history" /></button>
      <button className={view === 'favorites' ? 'active' : ''} aria-label="Favorites" onClick={onFavorites}><Icon name="heart" /></button>
      <button aria-label="Collections" onClick={() => notify('Collections - coming soon')}><Icon name="grid" /></button>
      <Link to="/cart" aria-label="Cart" className="dock-link"><Icon name="bag" /><span className={`cbadge ${cartCount ? 'show' : ''}`}>{cartCount}</span></Link>
      <Link to="/admin" aria-label="Creator analytics" className="dock-link"><Icon name="spark" /></Link>
    </nav>
  )
}

function Lightbox({ prompt, onClose, onAdd }: { prompt: Prompt; onClose: () => void; onAdd: (prompt: Prompt) => void }) {
  return (
    <div className="lb open" role="dialog" aria-modal="true" aria-labelledby="prompt-title" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="lb__card">
        <button className="lb__close" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        <div className="lb__img"><img src={prompt.imageUrl} alt={prompt.title} /></div>
        <div className="lb__info">
          <div className="model"><span className="d" />{prompt.model} · {prompt.category}</div>
          <h2 id="prompt-title">{prompt.title}</h2>
          <p className="desc">{prompt.description}</p>
          <div className="stats">
            <div><div className="k">Rating</div><div className="v">★ {prompt.rating}</div></div>
            <div><div className="k">Sold</div><div className="v">{format(prompt.sold)}</div></div>
            <div><div className="k">Seller</div><div className="v">{prompt.creator}</div></div>
          </div>
          <div className="lb__buy">
            <span className={`price ${prompt.price === 0 ? 'free' : ''}`}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</span>
            <Link to="/prompts/$promptId" params={{ promptId: prompt.slug }} className="ghost">Details</Link>
            <button className="add" onClick={() => { onAdd(prompt); onClose() }}>{prompt.price === 0 ? 'Get it free' : 'Add to cart'} <Icon name="plus" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

function distribute(prompts: Prompt[], count: number) {
  const cols: Prompt[][] = Array.from({ length: count }, () => [])
  prompts.forEach((prompt, index) => cols[index % cols.length].push(prompt))
  return cols
}

function format(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(n)
}

function toastOnly(message: string) {
  window.dispatchEvent(new CustomEvent('pp-toast', { detail: message }))
}
