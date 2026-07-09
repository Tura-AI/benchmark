"use client"

import { Link, useRouter } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import type { listPrompts } from '@/db/queries'
import { addCartAction, toggleFavoriteAction } from '@/server/marketplace'
import { Icon } from './icons'
import { Toast } from './layout'

type Prompt = Awaited<ReturnType<typeof listPrompts>>[number] & { imageUrl: string }
type StoreSearch = Record<string, unknown>

export function Storefront({ prompts, counts, searchState }: { prompts: Prompt[]; counts: { total: number; featured: number; free: number; favorites: number; cart: number; models: { model: string; count: number }[] }; searchState: Record<string, unknown> }) {
  const router = useRouter()
  const [toast, setToast] = useState('')
  const show = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2100) }
  const activeModel = String(searchState.model ?? 'all')
  const activeSort = String(searchState.sort ?? 'featured')
  const searchOpen = Boolean(searchState.q)

  const modelTabs = useMemo(() => ['all', 'GPT-4o', 'Claude', 'Midjourney', 'Flux'], [])
  const sizes = ['tall', '', '', 'wide', '', 'tall', '', '', '', 'wide']

  return (
    <>
      <div className="topbar">
        <div className="filterbar">
          <div className="ftabs" aria-label="Model filters">
            {modelTabs.map((model) => (
              <Link key={model} className={`ftab ${activeModel === model ? 'active' : ''}`} to="/" search={(old: StoreSearch) => ({ ...old, model })}>
                <Icon name={model === 'all' ? 'grid' : model === 'Flux' ? 'spark' : 'search'} /> {model === 'all' ? 'All' : model}
              </Link>
            ))}
          </div>
          <div className="fsort" aria-label="Sort controls">
            {(['featured', 'newest', 'popular'] as const).map((sort) => (
              <Link key={sort} className={`sortbtn ${activeSort === sort ? 'active' : ''}`} to="/" search={(old: StoreSearch) => ({ ...old, sort })}>{sort[0].toUpperCase() + sort.slice(1)}</Link>
            ))}
          </div>
        </div>
        <form className={`searchbar ${searchOpen ? 'open' : ''}`} onSubmit={(event) => event.preventDefault()}>
          <Icon name="search" />
          <input aria-label="Search prompts" placeholder="Search prompts, models, categories..." defaultValue={String(searchState.q ?? '')} onChange={(event) => router.navigate({ to: '/', search: (old: StoreSearch) => ({ ...old, q: event.target.value || undefined }) })} />
        </form>
      </div>

      <section className="hero">
        <div>
          <h1>Power prompts <em>for every model.</em></h1>
          <div className="metrics"><span>{counts.total} prompts</span><span>{counts.featured} featured</span><span>{counts.free} free</span></div>
        </div>
        <p>Curated prompts for GPT-4o, Claude, Midjourney, and Flux with save, cart, and checkout flows backed by local data.</p>
      </section>

      <section className="masonry" aria-label="Prompt gallery">
        {prompts.length === 0 ? <div className="empty"><div className="big">Nothing here yet</div><div>Try a different filter or search.</div></div> : prompts.map((prompt, index) => (
          <article key={prompt.id} className={`tile ${sizes[index % sizes.length]}`} style={{ '--ar': prompt.aspectRatio } as React.CSSProperties}>
            {prompt.isFavorite ? <div className="savedmark"><svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4V4Z" /></svg></div> : null}
            <Link to="/prompts/$promptId" params={{ promptId: String(prompt.id) }} className="media" aria-label={`View ${prompt.title}`}>
              <img src={prompt.imageUrl} alt={prompt.title} loading="lazy" onError={(event) => { event.currentTarget.replaceWith(fallback(prompt.title, index)) }} />
            </Link>
            <div className="ov">
              <div className="ov__top"><span className="model">{prompt.model}</span><button className={`bm ${prompt.isFavorite ? 'on' : ''}`} aria-label="Save" onClick={async () => { show(prompt.isFavorite ? 'Removed from favorites' : 'Saved to favorites'); try { await toggleFavoriteAction({ data: { promptId: prompt.id } }); await router.invalidate() } catch { show('Favorite could not be updated') } }}><Icon name="bag" /></button></div>
              <div>
                <h3>{prompt.title}</h3>
                <div className="ov__row"><span className={`price ${prompt.priceCents === 0 ? 'free' : ''}`}>{prompt.priceCents === 0 ? 'Free' : `$${prompt.priceCents / 100}`}</span><button className="add" onClick={async () => { show(`Added — ${prompt.title}`); try { await addCartAction({ data: { promptId: prompt.id } }); await router.invalidate() } catch { show('Cart could not be updated') } }}>Add</button></div>
              </div>
            </div>
          </article>
        ))}
      </section>
      <Toast message={toast} />
    </>
  )
}

function fallback(title: string, index: number) {
  const d = document.createElement('div')
  d.className = 'fb'
  d.style.setProperty('--fb-bg', index % 2 ? 'var(--lime)' : 'var(--ink)')
  d.style.setProperty('--fb-fg', index % 2 ? 'var(--ink)' : 'var(--lime)')
  d.innerHTML = `<span class="fb-mark">${title[0] ?? 'P'}</span>`
  return d
}
