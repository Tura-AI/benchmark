import { useEffect, useRef, useState, useTransition } from 'react'
import { addCartItem, getCatalog, toggleFavorite } from '../data/marketplace.functions'
import type { CatalogResult, Prompt, SortKey } from '../data/types'
import { Icon } from './Icon'
import { MarketplaceShell } from './MarketplaceShell'
import { PromptCard } from './PromptCard'
import { PromptPreview } from './PromptPreview'
import { Toast } from './Toast'

const models = ['all', 'GPT-4o', 'Claude', 'Midjourney', 'Flux']
const sorts: Array<{ value: SortKey; label: string }> = [{ value: 'featured', label: 'Featured' }, { value: 'newest', label: 'Newest' }, { value: 'popular', label: 'Popular' }]

export function Storefront({ initial }: { initial: CatalogResult }) {
  const [catalog, setCatalog] = useState(initial)
  const [model, setModel] = useState('all')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<SortKey>('featured')
  const [price, setPrice] = useState<'all' | 'free' | 'paid'>('all')
  const [favorites, setFavorites] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<Prompt | null>(null)
  const [toast, setToast] = useState('')
  const [pending, startTransition] = useTransition()
  const first = useRef(true)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify = (message: string) => { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2200) }

  useEffect(() => {
    if (first.current) { first.current = false; return }
    const timer = setTimeout(() => startTransition(async () => {
      const next = await getCatalog({ data: { model, category, sort, search, favorites, price } })
      setCatalog(next)
    }), search ? 180 : 0)
    return () => clearTimeout(timer)
  }, [model, category, sort, search, favorites, price])

  useEffect(() => {
    if (!preview) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [preview])

  const save = async (prompt: Prompt) => {
    const nextFavorite = prompt.favorite ? 0 : 1
    setCatalog((c) => ({ ...c, prompts: c.prompts.map((p) => p.id === prompt.id ? { ...p, favorite: nextFavorite } : p), counts: { ...c.counts, favorites: c.counts.favorites + (nextFavorite ? 1 : -1) } }))
    await toggleFavorite({ data: { promptId: prompt.id } })
    notify(nextFavorite ? 'Saved to favorites' : 'Removed from favorites')
    if (favorites && !nextFavorite) setCatalog((c) => ({ ...c, prompts: c.prompts.filter((p) => p.id !== prompt.id) }))
  }
  const add = async (prompt: Prompt) => {
    const cart = await addCartItem({ data: { promptId: prompt.id } })
    setCatalog((c) => ({ ...c, cartCount: cart.count }))
    setPreview(null)
    notify(prompt.price === 0 ? `Added free prompt — ${prompt.title}` : `Added — ${prompt.title}`)
  }
  const home = () => { setCategory('all'); setFavorites(false); setModel('all'); setPrice('all'); setSearch('') }

  return <MarketplaceShell cartCount={catalog.cartCount} activeCategory={category !== 'all' ? category : undefined} favoritesActive={favorites} onSearch={() => { setSearchOpen(true); setTimeout(() => document.querySelector<HTMLInputElement>('#market-search')?.focus(), 0) }} onFavorites={() => { setFavorites(true); setCategory('all'); setModel('all') }} onCategory={(c) => { setCategory(c); setFavorites(false) }} onNotice={notify}>
    <header className="market-header">
      <div className="filter-row">
        <div className="model-tabs" role="group" aria-label="Filter by model">{models.map((item) => <button key={item} className={model === item ? 'active' : ''} onClick={() => { setModel(item); setFavorites(false) }}>{item === 'all' && <Icon name="grid" />}{item === 'all' ? 'All' : item}</button>)}</div>
        <div className="sort-tabs" role="group" aria-label="Sort prompts">{sorts.map((item) => <button key={item.value} className={sort === item.value ? 'active' : ''} onClick={() => setSort(item.value)}>{item.label}</button>)}</div>
        <button className={`search-toggle ${searchOpen ? 'active' : ''}`} aria-label="Search prompts" onClick={() => setSearchOpen(!searchOpen)}><Icon name="search" /></button>
      </div>
      <div className={`search-panel ${searchOpen ? 'open' : ''}`}><Icon name="search" /><input id="market-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={'Search prompts — “portrait”, “poster”, “cold email”…'} aria-label="Search prompts"/><button aria-label="Close search" onClick={() => { setSearch(''); setSearchOpen(false) }}><Icon name="close" /></button></div>
    </header>
    <section className="gallery-section">
      <div className="gallery-intro"><div><span className="eyebrow">Curated prompt marketplace</span><h1>{favorites ? 'Your saved prompts' : category !== 'all' ? `${catalog.prompts[0]?.category ?? category} prompts` : 'Make something remarkable.'}</h1></div><div className="price-filter" role="group" aria-label="Filter by price"><button className={price === 'all' ? 'active' : ''} onClick={() => setPrice('all')}>All <span>{catalog.counts.all}</span></button><button className={price === 'free' ? 'active' : ''} onClick={() => setPrice('free')}>Free <span>{catalog.counts.free}</span></button><button className={price === 'paid' ? 'active' : ''} onClick={() => setPrice('paid')}>Paid <span>{catalog.counts.paid}</span></button></div></div>
      <div className={`result-meta ${pending ? 'loading' : ''}`}><span>{catalog.prompts.length} prompts</span><span>{pending ? 'Finding the best matches…' : sort === 'featured' ? 'Ranked for you' : `Sorted by ${sort}`}</span></div>
      {catalog.prompts.length ? <div className="masonry" data-testid="prompt-gallery">{catalog.prompts.map((prompt) => <PromptCard key={prompt.id} prompt={prompt} onPreview={setPreview} onFavorite={save} onAdd={add} />)}</div> : <div className="empty-state"><div>✦</div><h2>Nothing here yet</h2><p>{favorites ? 'Save a prompt and it will be waiting here.' : 'Try a different filter or search term.'}</p><button className="primary-button" onClick={home}>Browse all prompts</button></div>}
    </section>
    <PromptPreview prompt={preview} onClose={() => setPreview(null)} onAdd={add} />
    <Toast message={toast} />
  </MarketplaceShell>
}
