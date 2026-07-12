import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icons } from '../components/icons'
import { Lightbox } from '../components/Lightbox'
import { PromptCard } from '../components/PromptCard'
import { Toast } from '../components/Toast'
import { addToCartFn, getCatalogFn, toggleFavoriteFn } from '../server/functions'
import type { ModelName, PromptCard as Prompt, SortName } from '../server/types'

type Search = { model?: ModelName | 'all'; category?: string; sort?: SortName; q?: string; favorites?: boolean }

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    model: ['GPT-4o', 'Claude', 'Midjourney', 'Flux', 'all'].includes(String(search.model)) ? (search.model as Search['model']) : 'all',
    category: typeof search.category === 'string' ? search.category : 'all',
    sort: ['featured', 'newest', 'popular'].includes(String(search.sort)) ? (search.sort as SortName) : 'featured',
    q: typeof search.q === 'string' ? search.q : '',
    favorites: search.favorites === true || search.favorites === 'true',
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getCatalogFn({ data: { model: deps.model, category: deps.category, sort: deps.sort, term: deps.q, favoritesOnly: deps.favorites } }),
  component: Storefront,
})

function Storefront() {
  const router = useRouter()
  const search = Route.useSearch()
  const data = Route.useLoaderData()
  const [searchOpen, setSearchOpen] = useState(Boolean(search.q))
  const [toast, setToast] = useState('')
  const [preview, setPreview] = useState<Prompt | undefined>()
  const columns = useMemo(() => buildColumns(data.prompts, 4), [data.prompts])

  async function setSearch(next: Partial<Search>) {
    await router.navigate({ to: '/', search: (prev) => ({ ...prev, ...next }) })
  }
  async function mutateFavorite(id: number) {
    const result = await toggleFavoriteFn({ data: { promptId: id } })
    setToast(result.isFavorite ? 'Saved to favorites' : 'Removed from favorites')
    await router.invalidate()
  }
  async function mutateCart(id: number) {
    await addToCartFn({ data: { promptId: id } })
    setToast('Added to Cart')
    await router.invalidate()
  }

  return (
    <div className="app">
      <AppShell categories={data.categories} cartCount={data.cart.totals.itemCount} active={search.favorites ? 'favorites' : 'home'} onSearch={() => setSearchOpen((value) => !value)} onCategory={(category) => setSearch({ category, favorites: false })} onFavorites={() => setSearch({ favorites: true, model: 'all', category: 'all' })} />
      <main className="main">
        <div className="mtop"><button className="burger" type="button" aria-label="Open navigation"><Icons.Menu /></button><b>POWERPROMPT</b></div>
        <section className="topbar">
          <div className="filterbar">
            <div className="ftabs" aria-label="Model filters">
              {(['all', 'GPT-4o', 'Claude', 'Midjourney', 'Flux'] as const).map((model) => <button key={model} className={`ftab ${search.model === model ? 'active' : ''}`} onClick={() => setSearch({ model, favorites: false })} type="button">{model === 'all' ? 'All models' : model}</button>)}
            </div>
            <div className="fsort" aria-label="Sort controls">
              {(['featured', 'newest', 'popular'] as const).map((sort) => <button key={sort} className={`sortbtn ${search.sort === sort ? 'active' : ''}`} onClick={() => setSearch({ sort })} type="button">{labelSort(sort)}</button>)}
            </div>
          </div>
          <div className={`searchbar ${searchOpen ? 'open' : ''}`}>
            <div className="inner"><Icons.Search /><input value={search.q ?? ''} onChange={(event) => setSearch({ q: event.currentTarget.value })} placeholder="Search prompts, creators, models" aria-label="Search prompts" /></div>
          </div>
        </section>
        <section className="gallery" aria-label="Prompt marketplace gallery">
          <div className="gallery-head"><p className="mono">Featured {data.counts.featured} / Free {data.counts.free} / Paid {data.counts.paid}</p><h1>{search.favorites ? 'Favorites' : 'Prompt Gallery'}</h1><a href="/cart">Cart</a></div>
          <div className="masonry">
            {columns.map((column, index) => <div className="ms-col" key={index}>{column.map((prompt) => <PromptCard key={prompt.id} prompt={prompt} onFavorite={mutateFavorite} onCart={mutateCart} onPreview={setPreview} />)}</div>)}
          </div>
        </section>
      </main>
      <Lightbox prompt={preview} onClose={() => setPreview(undefined)} onCart={mutateCart} />
      <Toast message={toast} />
    </div>
  )
}

function buildColumns(prompts: Array<Prompt>, count: number) {
  return prompts.reduce<Array<Array<Prompt>>>((cols, prompt, index) => {
    cols[index % count].push(prompt)
    return cols
  }, Array.from({ length: count }, () => []))
}

function labelSort(sort: SortName) {
  return sort[0].toUpperCase() + sort.slice(1)
}
