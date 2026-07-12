import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { addCartAction, getPromptDetail, toggleFavoriteAction } from '../server/functions'
import { money } from '../components/PromptCard'

export const Route = createFileRoute('/prompts/$promptId')({
  loader: ({ params }) => getPromptDetail({ data: params.promptId }),
  component: PromptDetail,
})

function PromptDetail() {
  const prompt = Route.useLoaderData() as any
  const router = useRouter()
  const [favorite, setFavorite] = useState(Boolean(prompt?.favorite))
  const [notice, setNotice] = useState('')
  if (!prompt) return <div className="detail"><div className="panel"><h1>Prompt not found</h1><Link to="/">Back to gallery</Link></div></div>
  return <section className="detail">
    <div className="detail-grid">
      <img src={prompt.image} alt={`${prompt.title} full preview`} />
      <div className="panel">
        <p className="eyebrow mono">{prompt.model} · {prompt.category} · {prompt.featured ? 'Featured' : 'New prompt'}</p>
        <h1>{prompt.title}</h1>
        <p>{prompt.description}</p>
        <p><b>{money(prompt.priceCents)}</b> by {prompt.creator} {prompt.creatorHandle}</p>
        <p className="desc">Creator focus: {prompt.creatorSpecialty}. Rating {prompt.rating}; {prompt.sales} marketplace sales.</p>
        <div className="actions">
          <button className="primary" onClick={async () => { await addCartAction({ data: prompt.id }); setNotice('Added to Cart'); router.invalidate() }}>{prompt.priceCents ? 'Add to Cart' : 'Get free'}</button>
          <button className={`fav ${favorite ? 'on' : ''}`} aria-pressed={favorite} onClick={async () => { const next = await toggleFavoriteAction({ data: prompt.id }) as any; setFavorite(next.favorite); setNotice(next.favorite ? 'Saved to Favorites' : 'Removed from Favorites') }}>{favorite ? 'Saved' : 'Save'}</button>
          <Link to="/">Back</Link>
        </div>
      </div>
    </div>
    {notice ? <div role="status" className="toast">{notice}</div> : null}
  </section>
}
