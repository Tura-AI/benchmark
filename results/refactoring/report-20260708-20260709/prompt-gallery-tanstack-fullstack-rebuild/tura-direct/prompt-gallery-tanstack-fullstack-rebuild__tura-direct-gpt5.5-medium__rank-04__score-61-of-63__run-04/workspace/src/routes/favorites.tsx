import { createFileRoute } from '@tanstack/react-router'
import { useState, useTransition } from 'react'
import { Dock, MobileTop, Sidebar } from '~/components/Shell'
import { PromptCard } from '~/components/PromptCard'
import { cartAdd, fetchCatalog, favoritePrompt } from '~/data/server'
import type { PromptCard as Card } from '~/data/schema'

type CatalogState = { prompts: Card[]; counts: { freeCount: number; paidCount: number; favorites: number; cart: number } }

export const Route = createFileRoute('/favorites')({ loader: () => fetchCatalog({ data: { favoritesOnly: true } }), component: Favorites })

function Favorites() {
  const [catalog, setCatalog] = useState<CatalogState>(Route.useLoaderData() as CatalogState)
  const [drawer, setDrawer] = useState(false)
  const [, start] = useTransition()
  return <main className="app"><MobileTop onMenu={() => setDrawer(true)} /><Sidebar counts={catalog.counts} open={drawer} onClose={() => setDrawer(false)} onSearch={() => {}} /><section className="page narrow"><h1>Favorites</h1><p className="lede">Saved prompts stay query-backed instead of local-only state.</p><div className="masonry">{catalog.prompts.map((p) => <PromptCard key={p.id} prompt={p} onPreview={() => {}} onCart={(id) => start(async () => { await cartAdd({ data: { promptId: id } }); setCatalog(await fetchCatalog({ data: { favoritesOnly: true } })) })} onFavorite={(id) => start(async () => { await favoritePrompt({ data: { promptId: id } }); setCatalog(await fetchCatalog({ data: { favoritesOnly: true } })) })} />)}</div></section><Dock /></main>
}
