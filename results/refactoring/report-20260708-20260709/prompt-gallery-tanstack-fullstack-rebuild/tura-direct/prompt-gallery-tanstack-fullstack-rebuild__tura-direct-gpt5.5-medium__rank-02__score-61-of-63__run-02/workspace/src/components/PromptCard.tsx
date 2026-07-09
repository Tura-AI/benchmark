import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { addCartAction, toggleFavoriteAction } from '../server/functions'

export type PromptCardData = {
  id: string; title: string; model: string; priceCents: number; featured: number; image: string; ratio: string; description: string; category: string; creator: string; favorite: number; inCart: number; rank_score?: number
}

const money = (cents: number) => cents === 0 ? 'Free' : `$${(cents / 100).toFixed(0)}`

export function PromptCard({ prompt }: { prompt: PromptCardData }) {
  const router = useRouter()
  const [favorite, setFavorite] = useState(Boolean(prompt.favorite))
  const [notice, setNotice] = useState('')
  return <article className="card" style={{ ['--ratio' as string]: prompt.ratio }}>
    <div className="media">
      <img src={prompt.image} alt={`${prompt.title} preview`} loading="lazy" />
      <div className="overlay">
        <Link to="/prompts/$promptId" params={{ promptId: prompt.id }}>Preview</Link>
        <button onClick={async () => { await addCartAction({ data: prompt.id }); setNotice(`${prompt.title} added to Cart`); router.invalidate() }}>{prompt.priceCents ? 'Add' : 'Get free'}</button>
      </div>
    </div>
    <div className="card-body">
      <div className="meta mono"><span>{prompt.model}</span><span>{prompt.category}</span>{prompt.featured ? <span>Featured</span> : null}</div>
      <div className="title"><h2>{prompt.title}</h2><span className="price">{money(prompt.priceCents)}</span></div>
      <p className="desc">{prompt.description}</p>
      <div className="actions">
        <button className={`fav ${favorite ? 'on' : ''}`} aria-pressed={favorite} onClick={async () => { const next = await toggleFavoriteAction({ data: prompt.id }) as any; setFavorite(next.favorite); setNotice(next.favorite ? 'Saved to Favorites' : 'Removed from Favorites') }}>{favorite ? 'Saved' : 'Save'}</button>
        <Link to="/prompts/$promptId" params={{ promptId: prompt.id }}>Detail</Link>
      </div>
    </div>
    {notice ? <div role="status" className="toast">{notice}</div> : null}
  </article>
}

export { money }
