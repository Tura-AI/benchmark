import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import * as React from 'react'
import type { PromptCard, StorefrontData } from '~/data/types'
import { addPromptToCart, saveFavorite } from '~/data/server'
import { FormatMoney } from './FormatMoney'
import { BoltIcon, BookmarkIcon, Icon } from './icons'

const models = ['all', 'GPT-4o', 'Claude', 'Midjourney', 'Flux']
const sorts = ['featured', 'newest', 'popular'] as const

export function MarketplaceApp({ data }: { data: StorefrontData }) {
  const router = useRouter()
  const navigate = useNavigate({ from: '/' })
  const [searchOpen, setSearchOpen] = React.useState(Boolean(data.active.q))
  const [query, setQuery] = React.useState(data.active.q)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [toast, setToast] = React.useState('')
  const [lightbox, setLightbox] = React.useState<PromptCard | null>(null)
  const [hydrated, setHydrated] = React.useState(false)

  React.useEffect(() => setHydrated(true), [])

  React.useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(''), 2100)
    return () => window.clearTimeout(id)
  }, [toast])

  function setSearch(next: Partial<StorefrontData['active']> & { free?: boolean }) {
    navigate({
      search: (old) => ({
        ...old,
        ...next,
        model: next.model ?? old.model ?? 'all',
        category: next.category ?? old.category ?? 'all',
        sort: next.sort ?? old.sort ?? 'featured',
      }),
    })
  }

  async function favorite(prompt: PromptCard) {
    await saveFavorite({ data: { promptId: prompt.id } })
    setToast(prompt.isFavorite ? 'Removed from Favorites' : 'Saved to Favorites')
    await router.invalidate()
  }

  async function add(prompt: PromptCard) {
    await addPromptToCart({ data: { promptId: prompt.id } })
    setToast(`${prompt.price === 0 ? 'Claimed' : 'Added'} - ${prompt.title}`)
    await router.invalidate()
  }

  const visiblePrompts = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return data.prompts
    return data.prompts.filter((prompt) => `${prompt.title} ${prompt.model} ${prompt.category} ${prompt.description} ${prompt.creator}`.toLowerCase().includes(term))
  }, [data.prompts, query])

  const sidebarProps = {
    data,
    searchOpen,
    onSearch: () => setSearchOpen((value) => !value),
    onHome: () => { setQuery(''); setSearch({ model: 'all', category: 'all', q: '', favorites: false, free: false }) },
    onFavorites: () => setSearch({ model: 'all', category: 'all', favorites: true }),
    onCategory: (category: string) => setSearch({ category, favorites: false }),
    onFree: () => { setSearch({ free: true, favorites: false }); setToast('Showing free + featured prompts') },
    onClose: () => setDrawerOpen(false),
  }

  return (
    <>
      <div className="app-shell" data-hydrated={hydrated ? 'true' : 'false'}>
        <Sidebar {...sidebarProps} />
        <div className={drawerOpen ? 'scrim show' : 'scrim'} onClick={() => setDrawerOpen(false)} />
        <main className="main">
          <div className="mtop">
            <button className="burger" aria-label="Menu" onClick={() => setDrawerOpen(true)} onPointerUp={() => setDrawerOpen(true)}><Icon name="menu" /></button>
            <span className="bolt mini"><BoltIcon /></span>
            <b>POWERPROMPT</b>
          </div>
          <Topbar data={data} query={query} searchOpen={searchOpen} setSearchOpen={setSearchOpen} setSearch={setSearch} setQuery={setQuery} />
          <section className="gallery" aria-label="Prompt marketplace gallery">
            <div className="masonry">
              {visiblePrompts.length ? visiblePrompts.map((prompt) => (
                <PromptTile key={prompt.id} prompt={prompt} onFavorite={favorite} onAdd={add} onPreview={setLightbox} />
              )) : <div className="empty"><div className="big">Nothing here yet</div><div>Try a different filter or search.</div></div>}
            </div>
          </section>
        </main>
      </div>
      <Dock cartCount={data.counts.cart} favorites={data.active.favorites} onHome={() => setSearch({ favorites: false, model: 'all', category: 'all' })} onFavorites={() => setSearch({ favorites: true, model: 'all', category: 'all' })} />
      {lightbox ? <Lightbox prompt={lightbox} onClose={() => setLightbox(null)} onAdd={add} /> : null}
      <div className={toast ? 'toast show' : 'toast'} role="status"><span className="d" />{toast}</div>
      {drawerOpen ? <MobileDrawer><Sidebar {...sidebarProps} /></MobileDrawer> : null}
    </>
  )
}

function Sidebar(props: {
  data: StorefrontData
  searchOpen: boolean
  onSearch: () => void
  onHome: () => void
  onFavorites: () => void
  onCategory: (category: string) => void
  onFree: () => void
  onClose: () => void
}) {
  return (
    <aside className="sidebar">
      <div className="logo"><span className="bolt"><BoltIcon /></span><b>POWERPROMPT</b><span>Gallery</span></div>
      <button className="navi active" onClick={() => { props.onHome(); props.onClose() }}><Icon name="home" /> Home</button>
      <button className={props.searchOpen ? 'navi active' : 'navi'} onClick={props.onSearch}><Icon name="search" /> Search</button>
      <button className="navi" onClick={() => props.onClose()}><Icon name="history" /> History</button>
      <button className={props.data.active.favorites ? 'navi active' : 'navi'} onClick={() => { props.onFavorites(); props.onClose() }}><Icon name="heart" /> Favorites <span className="new">NEW</span></button>
      <div className="side-label">Categories</div>
      <button className={props.data.active.category === 'all' ? 'cat active' : 'cat'} onClick={() => props.onCategory('all')}><span className="dot" />All prompts</button>
      {props.data.categories.map((cat) => <button key={cat.id} className={props.data.active.category === cat.name ? 'cat active' : 'cat'} onClick={() => { props.onCategory(cat.name); props.onClose() }}><span className="dot" />{cat.name}</button>)}
      <div className="side-label">More from us</div>
      <Link className="navi" to="/admin/analytics"><Icon name="spark" /> Creator analytics</Link>
      <Link className="navi" to="/cart"><Icon name="cart" /> Cart</Link>
      <div className="side-foot">
        <div className="promo-card"><h4>Save 30% with prompt bundles</h4><p>Curated systems for teams shipping faster.</p></div>
        <div className="side-cta"><button className="btn-ink" onClick={() => props.onClose()}>Get started</button><button className="free" onClick={props.onFree}>Free prompts</button></div>
        <div className="side-legal"><a href="/admin/analytics">Revenue</a><span>Terms</span><span className="stars">4.8</span></div>
      </div>
    </aside>
  )
}

function Topbar({ data, query, searchOpen, setSearchOpen, setSearch, setQuery }: {
  data: StorefrontData
  query: string
  searchOpen: boolean
  setSearchOpen: (value: boolean) => void
  setSearch: (next: Partial<StorefrontData['active']> & { free?: boolean }) => void
  setQuery: (value: string) => void
}) {
  return (
    <div className="topbar">
      <div className="filterbar">
        <div className="ftabs" aria-label="Model filters">
          {models.map((model) => <button key={model} className={data.active.model === model ? 'ftab active' : 'ftab'} onClick={() => setSearch({ model })}><Icon name={model === 'all' ? 'grid' : model === 'Claude' ? 'spark' : model === 'GPT-4o' ? 'book' : 'code'} />{model === 'all' ? 'All' : model}</button>)}
        </div>
        <div className="fsort" aria-label="Sort controls">
          {sorts.map((sort) => <button key={sort} className={data.active.sort === sort ? 'sortbtn active' : 'sortbtn'} onClick={() => setSearch({ sort })}>{sort[0].toUpperCase() + sort.slice(1)}</button>)}
        </div>
        <button className="search-toggle" aria-label="Reveal search" onClick={() => setSearchOpen(!searchOpen)}><Icon name="search" /></button>
      </div>
      <div className={searchOpen ? 'searchbar open' : 'searchbar'}>
        <div className="inner"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={'Search prompts - portrait, poster, cold email...'} /></div>
      </div>
    </div>
  )
}

function PromptTile({ prompt, onFavorite, onAdd, onPreview }: { prompt: PromptCard; onFavorite: (prompt: PromptCard) => void; onAdd: (prompt: PromptCard) => void; onPreview: (prompt: PromptCard) => void }) {
  return (
    <article className={prompt.isFavorite ? 'tile saved' : 'tile'} style={{ aspectRatio: prompt.aspect }}>
      <button className="tile-hit" aria-label={`Open ${prompt.title}`} onClick={() => onPreview(prompt)} onPointerUp={() => onPreview(prompt)} />
      <div className="savedmark"><BookmarkIcon filled /></div>
      <div className="media"><img src={prompt.image} alt={prompt.title} loading="lazy" /></div>
      <div className="ov">
        <div className="ov__top"><span className="model">{prompt.model}</span><button className={prompt.isFavorite ? 'bm on' : 'bm'} aria-label="Save" onClick={(event) => { event.stopPropagation(); onFavorite(prompt) }}><BookmarkIcon filled={prompt.isFavorite} /></button></div>
        <div><h3>{prompt.title}</h3><div className="ov__row"><span className={prompt.price === 0 ? 'price free' : 'price'}><FormatMoney value={prompt.price} /></span><button className="add" onClick={(event) => { event.stopPropagation(); onAdd(prompt) }}>{prompt.price === 0 ? 'Get' : 'Add'}</button></div></div>
      </div>
    </article>
  )
}

function Dock({ cartCount, favorites, onHome, onFavorites }: { cartCount: number; favorites: boolean; onHome: () => void; onFavorites: () => void }) {
  return <nav className="dock" aria-label="Mobile actions"><button className={!favorites ? 'active' : ''} onClick={onHome} aria-label="Home"><Icon name="home" /></button><button onClick={onFavorites} className={favorites ? 'active' : ''} aria-label="Favorites"><Icon name="heart" /></button><Link to="/admin/analytics" aria-label="Analytics"><Icon name="spark" /></Link><Link to="/cart" aria-label="Cart"><Icon name="cart" /><span className={cartCount ? 'cbadge show' : 'cbadge'}>{cartCount}</span></Link></nav>
}

function Lightbox({ prompt, onClose, onAdd }: { prompt: PromptCard; onClose: () => void; onAdd: (prompt: PromptCard) => void }) {
  React.useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return (
    <div className="lb open" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lb__card" onClick={(event) => event.stopPropagation()}>
        <button className="lb__close" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        <div className="lb__img"><img src={prompt.image} alt={prompt.title} /></div>
        <div className="lb__info"><div className="model"><span className="d" />{prompt.model} / {prompt.category}</div><h2>{prompt.title}</h2><p className="desc">{prompt.description}</p><div className="stats"><div><div className="k">Rating</div><div className="v">{prompt.rating.toFixed(1)}</div></div><div><div className="k">Sold</div><div className="v">{prompt.sold.toLocaleString()}</div></div><div><div className="k">Seller</div><div className="v">{prompt.creator}</div></div></div><div className="lb__buy"><span className={prompt.price === 0 ? 'price free' : 'price'}><FormatMoney value={prompt.price} /></span><button className="add" onClick={() => onAdd(prompt)}>{prompt.price === 0 ? 'Get it free' : 'Add to cart'}</button><Link to="/prompts/$promptId" params={{ promptId: String(prompt.id) }}>Detail</Link></div></div>
      </div>
    </div>
  )
}

function MobileDrawer({ children }: { children: React.ReactNode }) {
  return <div className="mobile-drawer open">{children}</div>
}
