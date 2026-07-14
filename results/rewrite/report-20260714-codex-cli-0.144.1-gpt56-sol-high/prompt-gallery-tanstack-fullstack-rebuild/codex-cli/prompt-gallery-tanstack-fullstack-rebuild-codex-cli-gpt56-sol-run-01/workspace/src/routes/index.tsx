import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icons'
import { PromptCard } from '../components/PromptCard'
import { PromptModal } from '../components/PromptModal'
import { Toast } from '../components/Toast'
import type { CatalogData, Prompt } from '../lib/types'
import { getCatalogData } from '../server/marketplace.server'

export const Route = createFileRoute('/')({
  loader: () => getCatalogData({ data: {} }),
  component: Storefront,
})

const models = ['all','GPT-4o','Claude','Midjourney','Flux']
const sorts = ['featured','newest','popular'] as const

function Storefront() {
  const initial = Route.useLoaderData()
  const [catalog, setCatalog] = useState<CatalogData>(initial)
  const [model, setModel] = useState('all')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<typeof sorts[number]>('featured')
  const [term, setTerm] = useState('')
  const [favorites, setFavorites] = useState(false)
  const [free, setFree] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [preview, setPreview] = useState<Prompt | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const toast = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200) }
  const revealSearch = () => { setSearchOpen(true); window.setTimeout(() => searchRef.current?.focus(), 50) }
  const chooseCategory = (value: string) => {
    if (value === '__free') { setFree(true); setFavorites(false); setCategory('all'); toast('Showing free prompts') }
    else { setCategory(value === category ? 'all' : value); setFree(false); setFavorites(false) }
  }

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      const params = new URLSearchParams({ model, category, sort })
      if (term) params.set('q', term)
      if (favorites) params.set('favorites', 'true')
      if (free) params.set('free', 'true')
      try {
        const response = await fetch(`/api/prompts?${params}`, { signal: controller.signal })
        if (response.ok) setCatalog(await response.json())
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }, term ? 180 : 0)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [model, category, sort, term, favorites, free])

  const favoritePrompt = async (prompt: Prompt) => {
    const next = !prompt.isFavorite
    setCatalog((data) => ({ ...data, prompts: data.prompts.map((p) => p.id === prompt.id ? {...p,isFavorite:Number(next)} : p) }))
    setPreview((p) => p?.id === prompt.id ? {...p,isFavorite:Number(next)} : p)
    const response = await fetch('/api/favorites', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({promptId:prompt.id}) })
    if (!response.ok) return toast('Could not update favorites')
    toast(next ? 'Saved to Favorites' : 'Removed from Favorites')
    if (favorites && !next) setCatalog((data) => ({...data,prompts:data.prompts.filter((p)=>p.id!==prompt.id)}))
  }

  const cartPrompt = async (prompt: Prompt) => {
    const response = await fetch('/api/cart', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({promptId:prompt.id}) })
    if (!response.ok) return toast('Could not add prompt')
    const cart = await response.json()
    setCatalog((data) => ({...data,cartCount:cart.count}))
    toast(`${prompt.price ? 'Added' : 'Free prompt added'} — ${prompt.title}`)
  }

  const heading = useMemo(() => favorites ? 'Your saved prompts' : free ? 'Free prompts' : category !== 'all' ? category : 'Built to get you there', [favorites,free,category])

  return <AppShell categories={catalog.categories} activeCategory={category} cartCount={catalog.cartCount} onCategory={chooseCategory} onSearch={revealSearch} onFavorites={() => {setFavorites(true);setFree(false);setCategory('all')}} onNotice={toast}>
    <main className="storefront">
      <div className="topbar">
        <div className="filter-row">
          <div className="model-tabs" role="tablist" aria-label="Filter by model">
            {models.map((name) => <button key={name} className={model === name ? 'is-active' : ''} onClick={() => {setModel(name);setFavorites(false)}}>{name === 'all' && <Icon name="grid" />}{name === 'all' ? 'All' : name}</button>)}
          </div>
          <div className="sort-tabs" aria-label="Sort prompts">
            {sorts.map((name) => <button key={name} className={sort === name ? 'is-active' : ''} onClick={() => setSort(name)}>{name[0].toUpperCase()+name.slice(1)}</button>)}
          </div>
          <button className="search-trigger" onClick={() => setSearchOpen(!searchOpen)} aria-label="Toggle search"><Icon name={searchOpen ? 'close' : 'search'} /></button>
        </div>
        <div className={`search-reveal ${searchOpen ? 'is-open' : ''}`}><Icon name="search" /><input ref={searchRef} value={term} onChange={(e)=>setTerm(e.target.value)} placeholder={'Search prompts — “portrait”, “poster”, “cold email”…'} aria-label="Search prompts" />{term && <button onClick={()=>setTerm('')}>Clear</button>}</div>
      </div>
      <section className="gallery-wrap" aria-busy={loading}>
        <div className="gallery-heading"><div><p className="eyebrow">Curated tools for curious people</p><h1>{heading}<span>.</span></h1></div><p>{catalog.prompts.length} prompts · ranked by real marketplace signals</p></div>
        {catalog.prompts.length ? <div className={`masonry ${loading ? 'is-loading' : ''}`}>{catalog.prompts.map((prompt) => <PromptCard key={prompt.id} prompt={prompt} onFavorite={favoritePrompt} onCart={cartPrompt} onPreview={setPreview} />)}</div> : <div className="empty-state"><Icon name="search" /><h2>Nothing here yet</h2><p>{favorites ? 'Save a prompt and it will wait for you here.' : 'Try another model, category, or search.'}</p><button className="button button--dark" onClick={()=>{setTerm('');setFavorites(false);setFree(false);setModel('all');setCategory('all')}}>Clear filters</button></div>}
      </section>
    </main>
    <PromptModal prompt={preview} onClose={()=>setPreview(null)} onCart={cartPrompt} onFavorite={favoritePrompt} />
    <Toast message={notice} />
  </AppShell>
}
