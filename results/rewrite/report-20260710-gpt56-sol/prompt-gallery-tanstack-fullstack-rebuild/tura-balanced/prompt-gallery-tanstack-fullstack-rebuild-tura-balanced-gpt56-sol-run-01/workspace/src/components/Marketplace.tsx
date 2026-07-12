import { Grid2X2, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CartSummary, CatalogInput, Prompt } from '~/contracts'
import { models, sorts } from '~/contracts'
import { addPromptToCart, favoritePrompt, getCatalog } from '~/server/marketplace.functions'
import { AppShell } from './AppShell'
import { PromptCard } from './PromptCard'
import { PromptDetail } from './PromptDetail'

type CatalogData = { prompts: Prompt[]; counts: { total: number; free: number; paid: number; featured: number; favorites: number }; cart: CartSummary }

export function Marketplace({ initial }: { initial: CatalogData }) {
  const [data, setData] = useState(initial)
  const [filters, setFilters] = useState<CatalogInput>({ model: 'all', category: 'all', sort: 'featured', query: '', favoritesOnly: false, price: 'all' })
  const [searchOpen, setSearchOpen] = useState(false)
  const [preview, setPreview] = useState<Prompt | null>(null)
  const [toast, setToast] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const reload = async (next = filters) => setData(await getCatalog({ data: next }))
  const update = (patch: Partial<CatalogInput>) => { const next = { ...filters, ...patch }; setFilters(next); void reload(next) }
  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2200) }
  const toggleSearch = () => { setSearchOpen((value) => !value); window.setTimeout(() => searchRef.current?.focus(), 50) }
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null) }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [])

  const favorite = async (prompt: Prompt) => { const result = await favoritePrompt({ data: { promptId: prompt.id } }); showToast(result.favorite ? 'Saved to favorites' : 'Removed from favorites'); await reload() }
  const add = async (prompt: Prompt) => { const cart = await addPromptToCart({ data: { promptId: prompt.id, quantity: 1 } }); setData((old) => ({ ...old, cart })); showToast(`Added — ${prompt.title}`) }
  return <AppShell cartCount={data.cart.itemCount} onSearch={toggleSearch} favoritesActive={filters.favoritesOnly} category={filters.category} onCategory={(category) => update({ category, favoritesOnly: false })} onFavorites={() => update({ favoritesOnly: !filters.favoritesOnly, category: 'all' })}>
    <div className="topbar">
      <div className="filterbar"><div className="model-tabs" aria-label="Model filters">
        {models.map((model, index) => <button key={model} className={filters.model === model ? 'active' : ''} onClick={() => update({ model })}>{index === 0 ? <Grid2X2 /> : <Sparkles />}{model === 'all' ? 'All' : model}</button>)}
      </div><div className="sort-tabs" aria-label="Sort prompts">{sorts.map((sort) => <button key={sort} className={filters.sort === sort ? 'active' : ''} onClick={() => update({ sort })}>{sort[0].toUpperCase() + sort.slice(1)}</button>)}</div></div>
      <div className={`search-reveal ${searchOpen ? 'search-reveal--open' : ''}`}><Search /><input ref={searchRef} value={filters.query} onChange={(event) => update({ query: event.target.value })} placeholder="Search prompts — portrait, poster, cold email…" aria-label="Search prompts" /><button onClick={toggleSearch} aria-label="Close search"><X /></button></div>
      <div className="result-strip"><span><SlidersHorizontal />{data.prompts.length} prompts</span><div><button className={filters.price === 'all' ? 'active' : ''} onClick={() => update({ price: 'all' })}>All {data.counts.total}</button><button className={filters.price === 'free' ? 'active' : ''} onClick={() => update({ price: 'free' })}>Free {data.counts.free}</button><button className={filters.price === 'paid' ? 'active' : ''} onClick={() => update({ price: 'paid' })}>Paid {data.counts.paid}</button></div></div>
    </div>
    <main className="gallery" aria-live="polite">{data.prompts.length ? <div className="masonry">{data.prompts.map((prompt) => <PromptCard key={prompt.id} prompt={prompt} onOpen={() => setPreview(prompt)} onFavorite={() => void favorite(prompt)} onCart={() => void add(prompt)} />)}</div> : <div className="empty-state"><strong>Nothing here yet</strong><span>{filters.favoritesOnly ? 'Save a prompt to build your collection.' : 'Try a different filter or search.'}</span></div>}</main>
    {preview && <PromptDetail prompt={preview} onClose={() => setPreview(null)} onChanged={() => { void reload(); showToast('Collection updated') }} />}
    <div className={`toast ${toast ? 'toast--show' : ''}`} role="status"><span />{toast}</div>
  </AppShell>
}
