import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import type { CatalogFilters } from '../server/queries'
import { addToCartFn, toggleFavoriteFn, type PromptRow } from '../server/queries'
import { Icons } from './icons'
import { useToast } from './toast'

const models = ['all', 'GPT-4o', 'Claude', 'Midjourney', 'Flux'] as const
const sorts = ['featured', 'newest', 'popular'] as const

function imageFallback(event: React.SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none'
  event.currentTarget.parentElement?.classList.add('fb')
}

export function Storefront({ prompts, categories, counts, previewPrompt }: { prompts: PromptRow[]; categories: string[]; counts: { total: number; free: number; paid: number; featured: number }; previewPrompt?: PromptRow | null }) {
  const search = useSearch({ strict: false }) as CatalogFilters & { favorites?: string; free?: string; preview?: string }
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [searchOpen, setSearchOpen] = useState(Boolean(search.q))
  const [clientPreview, setClientPreview] = useState<PromptRow | null>(null)
  const previewId = search.preview == null ? undefined : String(search.preview).replace(/^"|"$/g, '')
  const selected = clientPreview ?? previewPrompt ?? prompts.find((prompt) => String(prompt.id) === previewId) ?? null

  useEffect(() => {
    const reveal = () => setSearchOpen((value) => !value)
    const toast = (event: Event) => showToast((event as CustomEvent<string>).detail)
    window.addEventListener('powerprompt:search', reveal)
    window.addEventListener('powerprompt:toast', toast)
    return () => {
      window.removeEventListener('powerprompt:search', reveal)
      window.removeEventListener('powerprompt:toast', toast)
    }
  }, [showToast])

  useEffect(() => {
    if (!previewId) {
      setClientPreview(null)
      return
    }
    const prompt = previewPrompt ?? prompts.find((item) => String(item.id) === previewId) ?? null
    setClientPreview(prompt)
  }, [previewId, previewPrompt, prompts])

  const current = useMemo(() => ({
    model: search.model ?? 'all',
    category: search.category ?? 'all',
    sort: search.sort ?? 'featured',
    q: search.q ?? '',
    favorites: search.favorites,
    free: search.free,
    preview: search.preview,
  }), [search])

  const update = (patch: Record<string, string | undefined>) => void navigate({ to: '/', search: { ...current, ...patch } })
  const openPreview = (id: number) => {
    setClientPreview(prompts.find((prompt) => prompt.id === id) ?? null)
    update({ preview: String(id) })
  }
  const closePreview = () => {
    setClientPreview(null)
    update({ preview: undefined })
  }

  const favorite = async (id: number) => {
    const result = await toggleFavoriteFn({ data: id })
    showToast(result.isFavorite ? 'Saved to favorites' : 'Removed from favorites')
    await navigate({ to: '/', search: (old) => old, replace: true })
  }
  const add = async (id: number) => {
    await addToCartFn({ data: id })
    showToast('Added to cart')
    await navigate({ to: '/', search: (old) => old, replace: true })
  }

  return (
    <>
      <div className="topbar">
        <div className="filterbar">
          <div className="ftabs" aria-label="Model filters">
            {models.map((model) => (
              <button key={model} className={`ftab ${current.model === model ? 'active' : ''}`} type="button" onClick={() => update({ model, favorites: undefined, free: undefined })}>
                <Icons.Sparkles size={15} /> {model === 'all' ? 'All' : model}
              </button>
            ))}
          </div>
          <div className="fsort" aria-label="Sort prompts">
            <button className="sortbtn" type="button" aria-label="Reveal search" onClick={() => setSearchOpen((value) => !value)}>Search</button>
            {sorts.map((sort) => <button key={sort} className={`sortbtn ${current.sort === sort ? 'active' : ''}`} type="button" onClick={() => update({ sort })}>{sort[0].toUpperCase() + sort.slice(1)}</button>)}
            <button className={`sortbtn ${current.favorites === '1' ? 'active' : ''}`} type="button" onClick={() => update({ favorites: current.favorites === '1' ? undefined : '1' })}>Favorites</button>
            <button className={`sortbtn ${current.free === '1' ? 'active' : ''}`} type="button" onClick={() => update({ free: current.free === '1' ? undefined : '1' })}>Free {counts.free}</button>
          </div>
        </div>
        <div className={`searchbar ${searchOpen ? 'open' : ''}`}>
          <div className="inner">
            <Icons.Search />
            <input aria-label="Search prompts" value={current.q} onChange={(event) => update({ q: event.currentTarget.value })} placeholder="Search prompts - portrait, poster, cold email..." />
          </div>
        </div>
      </div>
      <div className="gallery">
        {current.category !== 'all' ? <div className="side-label">{current.category}</div> : null}
        {prompts.length === 0 ? (
          <div className="empty"><div className="big">Nothing here yet</div><div>{current.favorites === '1' ? 'Tap the bookmark on any prompt to save it.' : 'Try a different filter or search.'}</div></div>
        ) : (
          <div className="masonry" data-testid="prompt-gallery">
            {prompts.map((prompt, index) => (
              <article className={`tile ${prompt.isFavorite ? 'saved' : ''}`} key={prompt.id} style={{ '--ar': prompt.aspect } as React.CSSProperties}>
                <div className="savedmark"><Icons.Bookmark size={16} fill="currentColor" /></div>
                <button className="media" type="button" onClick={() => openPreview(prompt.id)} aria-label={`Preview ${prompt.title}`}>
                  <img src={prompt.imageUrl} alt={prompt.title} loading={index < 6 ? 'eager' : 'lazy'} onError={imageFallback} />
                  <span className="fb-mark" aria-hidden="true">{prompt.title[0]}</span>
                </button>
                <div className="ov" onClick={(event) => { if (!(event.target as HTMLElement).closest('a,button')) openPreview(prompt.id) }}>
                  <div className="ov__top"><span className="model">{prompt.model}</span><div className="ov__actions"><button className="bm" type="button" aria-label={`Open preview ${prompt.title}`} onClick={() => openPreview(prompt.id)}><Icons.Search size={17} /></button><button className={`bm ${prompt.isFavorite ? 'on' : ''}`} type="button" aria-label="Save" onClick={() => void favorite(prompt.id)}><Icons.Bookmark size={17} /></button></div></div>
                  <div><h3><Link to="/prompts/$promptId" params={{ promptId: String(prompt.id) }}>{prompt.title}</Link></h3><div className="ov__row"><span className={`price ${prompt.price === 0 ? 'free' : ''}`}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</span><button className="add" type="button" onClick={() => void add(prompt.id)}>Add <Icons.ArrowRight size={12} /></button></div></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      {selected ? <PromptPreview prompt={selected} onClose={closePreview} onAdd={() => void add(selected.id)} /> : null}
    </>
  )
}

function PromptPreview({ prompt, onClose, onAdd }: { prompt: PromptRow; onClose: () => void; onAdd: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return (
    <div className="lb open" role="dialog" aria-modal="true" aria-label={prompt.title} onClick={onClose}>
      <div className="lb__card detail-grid" onClick={(event) => event.stopPropagation()}>
        <button className="lb__close" type="button" aria-label="Close preview" onClick={onClose}><Icons.X size={18} /></button>
        <div className="detail-image" style={{ '--ar': prompt.aspect } as React.CSSProperties}><img src={prompt.imageUrl} alt={prompt.title} /></div>
        <div className="lb__info detail">
          <div className="model"><span className="d" />{prompt.model} / {prompt.category}</div>
          <h2>{prompt.title}</h2>
          <p className="desc">{prompt.description}</p>
          <div className="stats"><div><div className="k">Sold</div><div className="v">{prompt.sold.toLocaleString()}</div></div><div><div className="k">Rating</div><div className="v">{prompt.rating}</div></div><div><div className="k">Creator</div><div className="v">{prompt.creator}</div></div></div>
          <div className="lb__buy"><span className={`price ${prompt.price === 0 ? 'free' : ''}`}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</span><button className="add" type="button" onClick={onAdd}>{prompt.price === 0 ? 'Get it free' : 'Add to cart'} <Icons.ArrowRight size={14} /></button></div>
        </div>
      </div>
    </div>
  )
}
