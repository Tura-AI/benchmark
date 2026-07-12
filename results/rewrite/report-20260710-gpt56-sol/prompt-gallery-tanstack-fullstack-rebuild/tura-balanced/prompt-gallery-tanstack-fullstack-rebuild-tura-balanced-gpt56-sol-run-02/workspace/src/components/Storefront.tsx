import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowRight, Bookmark, Check, Search, ShoppingBag, Star, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CatalogInput, Prompt } from '../contracts/marketplace'
import { models, sorts } from '../contracts/marketplace'
import { addCartFn, favoriteFn } from '../server/functions'
import { AppShell } from './AppShell'

const money = (cents: number) => cents ? `$${(cents / 100).toFixed(0)}` : 'Free'

function PromptCard({ prompt, onPreview, onToast }: { prompt: Prompt; onPreview: (p: Prompt) => void; onToast: (s: string) => void }) {
  const router = useRouter()
  const mutateFavorite = async (event: React.MouseEvent) => {
    event.stopPropagation(); await favoriteFn({ data: { promptId: prompt.id } }); await router.invalidate(); onToast(prompt.favorite ? 'Removed from favorites' : 'Saved to favorites')
  }
  const add = async (event: React.MouseEvent) => {
    event.stopPropagation(); await addCartFn({ data: { promptId: prompt.id } }); await router.invalidate(); onToast(`Added — ${prompt.title}`)
  }
  return <article className="prompt-card" style={{ '--aspect': prompt.aspect } as React.CSSProperties} onClick={() => onPreview(prompt)}>
    <img src={prompt.image} alt={prompt.title} loading="lazy" />
    {prompt.favorite && <span className="saved-mark"><Bookmark fill="currentColor" /></span>}
    <div className="card-overlay">
      <div className="overlay-top"><span>{prompt.model}</span><button className={prompt.favorite ? 'saved' : ''} onClick={mutateFavorite} aria-label={`${prompt.favorite ? 'Remove' : 'Save'} ${prompt.title}`}><Bookmark fill={prompt.favorite ? 'currentColor' : 'none'} /></button></div>
      <div><h2>{prompt.title}</h2><div className="card-action"><strong className={!prompt.priceCents ? 'free' : ''}>{money(prompt.priceCents)}</strong><button onClick={add}>Add <ArrowRight /></button></div></div>
    </div>
  </article>
}

function Preview({ prompt, close, toast }: { prompt: Prompt; close: () => void; toast: (s: string) => void }) {
  const router = useRouter()
  useEffect(() => { const key = (e: KeyboardEvent) => e.key === 'Escape' && close(); addEventListener('keydown',key); return () => removeEventListener('keydown',key) }, [close])
  const add = async () => { await addCartFn({ data: { promptId: prompt.id } }); await router.invalidate(); toast(`Added — ${prompt.title}`); close() }
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label={prompt.title} onMouseDown={(e) => e.target === e.currentTarget && close()}>
    <div className="preview-card"><button className="preview-close" onClick={close} aria-label="Close preview"><X /></button>
      <div className="preview-media"><img src={prompt.image} alt={prompt.title} /></div>
      <div className="preview-copy"><span className="eyebrow"><i />{prompt.model} · {prompt.category}</span><h1>{prompt.title}</h1><p>{prompt.description}</p>
        <dl><div><dt>Rating</dt><dd><Star fill="currentColor" /> {prompt.rating}</dd></div><div><dt>Sold</dt><dd>{prompt.sold.toLocaleString()}</dd></div><div><dt>Creator</dt><dd>{prompt.creatorName}</dd></div></dl>
        <div className="preview-buy"><strong>{money(prompt.priceCents)}</strong><Link to="/prompts/$promptId" params={{ promptId: prompt.id }}>Full details</Link><button onClick={add}>{prompt.priceCents ? 'Add to cart' : 'Get it free'}<ArrowRight /></button></div>
      </div>
    </div>
  </div>
}

export function Storefront({ data, search }: { data: { prompts: Prompt[]; categories: Array<{name:string;count:number}>; counts: Record<string,number>; cartCount:number }; search: CatalogInput }) {
  const navigate = useNavigate({ from: '/' })
  const [searchOpen, setSearchOpen] = useState(Boolean(search.q))
  const [query, setQuery] = useState(search.q)
  const [preview, setPreview] = useState<Prompt | null>(null)
  const [toast, setToast] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const update = (next: Partial<CatalogInput>) => navigate({ search: (old) => ({ ...old, ...next }), replace: true })
  const notify = (message: string) => { setToast(message); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(''), 2200) }
  useEffect(() => {
    if (query === search.q) return
    const timeout = setTimeout(() => update({ q: query }), 220)
    return () => clearTimeout(timeout)
  }, [query, search.q])
  return <AppShell cartCount={data.cartCount} activeCategory={search.category} onCategory={(category) => update({ category, favorites: false })} onSearch={() => setSearchOpen(true)}>
    <div className="sticky-filters">
      <div className="filter-row"><div className="model-tabs">{models.map((model) => <button key={model} className={search.model === model ? 'active' : ''} onClick={() => update({ model })}>{model === 'all' ? 'All' : model}</button>)}</div>
        <div className="sort-tabs">{sorts.map((sort) => <button key={sort} className={search.sort === sort ? 'active' : ''} onClick={() => update({ sort })}>{sort[0].toUpperCase()+sort.slice(1)}</button>)}</div></div>
      <div className={`search-reveal ${searchOpen ? 'open' : ''}`}><Search /><input autoFocus={searchOpen} value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Search prompts — “portrait”, “writing”, “brand”' aria-label="Search prompts"/><button onClick={() => { setSearchOpen(false); setQuery(''); update({ q: '' }) }} aria-label="Close search"><X /></button></div>
    </div>
    <main className="gallery-wrap">
      <div className="gallery-status"><span>{search.favorites ? 'Favorites' : search.category !== 'all' ? search.category : 'Curated prompts'}</span><small>{data.prompts.length} results · {data.counts.free} free</small></div>
      {data.prompts.length ? <div className="masonry">{data.prompts.map((prompt) => <PromptCard key={prompt.id} prompt={prompt} onPreview={setPreview} onToast={notify} />)}</div> : <div className="empty-state"><Bookmark /><h1>Nothing here yet</h1><p>{search.favorites ? 'Save a prompt to build your shortlist.' : 'Try a different filter or search.'}</p><button onClick={() => update({model:'all',category:'all',q:'',favorites:false,free:false})}>Clear filters</button></div>}
    </main>
    {preview && <Preview prompt={preview} close={() => setPreview(null)} toast={notify} />}
    <div className={`toast ${toast ? 'show' : ''}`} role="status"><Check />{toast}</div>
  </AppShell>
}
