import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { PromptCard } from '../components/PromptCard'
import { getCatalog } from '../server/functions'

const Search = z.object({ model: z.string().catch('all').optional(), category: z.string().catch('all').optional(), sort: z.enum(['Featured','Newest','Popular']).catch('Featured').optional(), search: z.string().catch('').optional(), favoritesOnly: z.boolean().catch(false).optional() })

export const Route = createFileRoute('/')({
  validateSearch: Search,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getCatalog({ data: deps }),
  component: Storefront,
})

function Storefront() {
  const data = Route.useLoaderData() as any
  const search = Route.useSearch() as any
  const navigate = useNavigate({ from: '/' })
  const [searchOpen, setSearchOpen] = useState(Boolean(search.search))
  const set = (patch: Record<string, unknown>) => navigate({ search: (old) => ({ ...old, ...patch }) })
  return <>
    <section className="top">
      <div className="hero">
        <div><p className="eyebrow mono">Prompt systems for beauty commerce</p><h1>POWERPROMPT gallery</h1></div>
        <p>Browse ranked prompt products backed by SQLite data: Featured, Newest, Popular, Favorites, and Cart all work through server functions.</p>
      </div>
      <div className="filters" aria-label="Catalog filters">
        {['all','GPT-4o','Claude','Midjourney','Flux'].map((model) => <button key={model} className={`tab ${((search.model ?? 'all') === model) ? 'active' : ''}`} onClick={() => set({ model })}>{model === 'all' ? 'All models' : model}</button>)}
        <button className="iconbtn" onClick={() => setSearchOpen(!searchOpen)}>Search</button>
        <label className={`search ${searchOpen ? 'open' : ''}`}><span className="mono" style={{position:'absolute',left:-9999}}>Search prompts</span><input defaultValue={search.search ?? ''} placeholder="Search makeup, Flux, serum..." onChange={(event) => set({ search: event.currentTarget.value })} /></label>
        {['Featured','Newest','Popular'].map((sort) => <button key={sort} className={`sort ${((search.sort ?? 'Featured') === sort) ? 'active' : ''}`} onClick={() => set({ sort })}>{sort}</button>)}
        <button className={`sort ${search.favoritesOnly ? 'active' : ''}`} onClick={() => set({ favoritesOnly: !search.favoritesOnly })}>Favorites</button>
      </div>
    </section>
    <section className="gallery" aria-label="Prompt marketplace gallery">
      {data.prompts.map((prompt: any) => <PromptCard key={prompt.id} prompt={prompt} />)}
    </section>
  </>
}
