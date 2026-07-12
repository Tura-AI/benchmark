import { createFileRoute } from '@tanstack/react-router'
import { Filter, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { catalogFn, cartFn } from '../server/functions'
import { Dock } from '../ui/Dock'
import { useApp } from '../ui/AppContext'
import { PromptCard } from '../ui/PromptCard'

const searchSchema = z.object({ category: z.string().optional(), view: z.enum(['favorites','search']).optional(), free: z.boolean().optional() })
export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => Promise.all([catalogFn({ data: { model:'all', category:deps.category ?? 'all', sort:'featured', search:'', favorites:deps.view === 'favorites', free:Boolean(deps.free) } }), cartFn()]),
  component: Storefront,
})

const models = ['all','GPT-4o','Claude','Midjourney','Flux'] as const
const sorts = ['featured','newest','popular'] as const

function Storefront() {
  const initial = Route.useLoaderData()
  const routeSearch = Route.useSearch()
  const { setCartCount } = useApp()
  const [model, setModel] = useState<(typeof models)[number]>('all')
  const [sort, setSort] = useState<(typeof sorts)[number]>('featured')
  const [term, setTerm] = useState('')
  const [searchOpen, setSearchOpen] = useState(routeSearch.view === 'search')
  const [catalog, setCatalog] = useState(initial[0])
  const [loading, setLoading] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const query = useMemo(() => ({ model, sort, search:term, category:routeSearch.category ?? 'all', favorites:routeSearch.view === 'favorites', free:Boolean(routeSearch.free) }), [model, sort, term, routeSearch])
  const visiblePrompts = useMemo(() => model === 'all' ? catalog.prompts : catalog.prompts.filter((prompt) => prompt.model === model), [catalog.prompts, model])
  useEffect(() => setCartCount(initial[1].itemCount), [initial, setCartCount])
  useEffect(() => setHydrated(true), [])
  useEffect(() => {
    let active = true; setLoading(true)
    const params = new URLSearchParams({ model: query.model, category: query.category, sort: query.sort, search: query.search, favorites: String(query.favorites), free: String(query.free) })
    const timer = window.setTimeout(() => fetch(`/api/prompts?${params}`, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error('Catalog request failed'); return response.json() }).then((data) => { if (active) setCatalog(data) }).finally(() => { if (active) setLoading(false) }), 120)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query])
  const title = routeSearch.view === 'favorites' ? 'Favorites' : routeSearch.category ? routeSearch.category : routeSearch.free ? 'Free prompts' : 'Discover'
  return <>
    <div className="store-top">
      <div className="mobile-title"><div><span className="eyebrow">Prompt marketplace</span><h1>{title}</h1></div><button className="icon-button" aria-label="Toggle search" onClick={() => setSearchOpen((value) => !value)}>{searchOpen ? <X /> : <Search />}</button></div>
      <div className="filter-row"><div className="model-tabs" role="group" aria-label="Model filter">{models.map((item) => <button disabled={!hydrated} className={model === item ? 'active' : ''} onClick={() => setModel(item)} key={item}>{item === 'all' ? <><Filter />All</> : item}</button>)}</div><div className="sort-tabs" role="group" aria-label="Sort prompts">{sorts.map((item) => <button disabled={!hydrated} className={sort === item ? 'active' : ''} onClick={() => setSort(item)} key={item}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div><button disabled={!hydrated} className="desktop-search icon-button" aria-label="Toggle search" onClick={() => setSearchOpen((value) => !value)}><Search /></button></div>
      <div className={`search-reveal ${searchOpen ? 'open' : ''}`}><Search /><input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search prompts, creators, and outcomes" aria-label="Search prompts" /></div>
    </div>
    <main className={`gallery-wrap ${loading ? 'loading' : ''}`}><div className="gallery-heading"><div><span className="eyebrow">{visiblePrompts.length} curated tools</span><h1>{title}</h1></div><p><b>{catalog.counts.free}</b> free · <b>{catalog.counts.featured}</b> featured</p></div>{visiblePrompts.length ? <div className="masonry">{visiblePrompts.map((prompt) => <PromptCard prompt={prompt} key={prompt.id} />)}</div> : <div className="empty"><Search /><h2>No prompts found</h2><p>Try another model or a shorter search.</p></div>}</main><Dock />
  </>
}
