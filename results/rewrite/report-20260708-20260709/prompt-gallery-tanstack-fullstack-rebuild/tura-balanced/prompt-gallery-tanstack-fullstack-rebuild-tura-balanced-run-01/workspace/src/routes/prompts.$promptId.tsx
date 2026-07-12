import { Link, createFileRoute } from '@tanstack/react-router'

import { AppShell } from '../components/AppShell'
import { Icons } from '../components/icons'
import { useToast } from '../components/toast'
import { addToCartFn, getCartFn, getPromptFn, toggleFavoriteFn } from '../server/queries'

export const Route = createFileRoute('/prompts/$promptId')({
  loader: async ({ params }) => {
    const id = Number(params.promptId)
    const [prompt, cart] = await Promise.all([getPromptFn({ data: id }), getCartFn()])
    if (!prompt) throw new Error('Prompt not found')
    return { prompt, cart }
  },
  component: PromptRoute,
})

function PromptRoute() {
  const { prompt, cart } = Route.useLoaderData()
  const { showToast } = useToast()
  return (
    <AppShell cartCount={cart.totals.itemCount}>
      <div className="detail-page">
        <div className="detail-grid panel">
          <div className="detail-image" style={{ '--ar': prompt.aspect } as React.CSSProperties}><img src={prompt.imageUrl} alt={prompt.title} /></div>
          <section className="detail">
            <div className="model">{prompt.model} / {prompt.category}</div>
            <h1>{prompt.title}</h1>
            <p className="desc">{prompt.description}</p>
            <div className="stat-row"><span>Creator</span><strong>{prompt.creator}</strong></div>
            <div className="stat-row"><span>Rank score</span><strong>{prompt.rankScore}</strong></div>
            <div className="stat-row"><span>Sold</span><strong>{prompt.sold.toLocaleString()}</strong></div>
            <div className="stat-row"><span>Rating</span><strong>{prompt.rating}</strong></div>
            <div className="lb__buy">
              <span className={`price ${prompt.price === 0 ? 'free' : ''}`}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</span>
              <button className="bm" type="button" aria-label="Save" onClick={() => void toggleFavoriteFn({ data: prompt.id }).then((r) => showToast(r.isFavorite ? 'Saved to favorites' : 'Removed from favorites'))}><Icons.Bookmark /></button>
              <button className="add" type="button" onClick={() => void addToCartFn({ data: prompt.id }).then(() => showToast('Added to cart'))}>Add to cart <Icons.ArrowRight size={14} /></button>
            </div>
            <p><Link to="/">Back to gallery</Link></p>
          </section>
        </div>
      </div>
    </AppShell>
  )
}
