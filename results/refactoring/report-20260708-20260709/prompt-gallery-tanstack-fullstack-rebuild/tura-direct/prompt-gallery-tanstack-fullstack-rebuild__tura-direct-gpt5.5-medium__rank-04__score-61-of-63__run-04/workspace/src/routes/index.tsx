import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState, useTransition } from 'react'
import { Dock, MobileTop, Sidebar, Topbar } from '~/components/Shell'
import { Lightbox, PromptCard } from '~/components/PromptCard'
import { cartAdd, favoritePrompt, fetchCart, fetchCatalog } from '~/data/server'
import type { PromptCard as Card } from '~/data/schema'

export const Route = createFileRoute('/')({
  validateSearch: (s) => ({ category: typeof s.category === 'string' ? s.category : 'All' }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => fetchCatalog({ data: { category: deps.category } }),
  component: Storefront,
})

function Storefront() {
  const initial = Route.useLoaderData()
  const [model, setModel] = useState('All')
  const [sort, setSort] = useState('Featured')
  const [term, setTerm] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [preview, setPreview] = useState<Card | null>(null)
  const [catalog, setCatalog] = useState(initial)
  const [cart, setCart] = useState<any>()
  const [toast, setToast] = useState('')
  const [, start] = useTransition()
  const prompts = useMemo(() => catalog.prompts, [catalog])
  function refresh(next = { model, sort, term }) { start(async () => setCatalog(await fetchCatalog({ data: next as any }))) }
  function note(text: string) { setToast(text); window.setTimeout(() => setToast(''), 1800) }
  return <main className="app"><MobileTop onMenu={() => setDrawer(true)} /><Sidebar counts={catalog.counts} open={drawer} onClose={() => setDrawer(false)} onSearch={() => setSearchOpen(true)} /><section className="page"><Topbar searchOpen={searchOpen} setSearchOpen={setSearchOpen} term={term} setTerm={(v: string) => { setTerm(v); refresh({ model, sort, term: v }) }} model={model} setModel={(v: string) => { setModel(v); refresh({ model: v, sort, term }) }} sort={sort} setSort={(v: string) => { setSort(v); refresh({ model, sort: v, term }) }} /><div className="hero"><p className="mono">Featured prompt marketplace</p><h1>Power prompts for images, writing, code, marketing, and research.</h1><p>Ranked by database scoring across rating, sales, recency, price, and featured status.</p></div><div className="masonry">{prompts.map((p) => <PromptCard key={p.id} prompt={p} onPreview={setPreview} onFavorite={(id) => start(async () => { await favoritePrompt({ data: { promptId: id } }); refresh(); note('Favorites updated') })} onCart={(id) => start(async () => { setCart(await cartAdd({ data: { promptId: id } })); refresh(); note('Cart updated') })} />)}</div></section><Dock cart={cart} /><Lightbox prompt={preview} onClose={() => setPreview(null)} onCart={(id) => start(async () => { setCart(await cartAdd({ data: { promptId: id } })); setPreview(null); note('Added to Cart') })} />{toast ? <div className="toast">{toast}</div> : null}</main>
}
