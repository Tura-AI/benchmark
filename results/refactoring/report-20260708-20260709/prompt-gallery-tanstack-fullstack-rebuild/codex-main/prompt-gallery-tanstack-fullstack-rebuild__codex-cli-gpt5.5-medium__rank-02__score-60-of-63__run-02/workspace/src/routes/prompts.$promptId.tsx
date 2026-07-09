import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { Icon } from '../components/Icons'
import { apiUrl } from '../utils/api-url'

export const Route = createFileRoute('/prompts/$promptId')({
  loader: async ({ params }) => {
    const res = await fetch(apiUrl(`/api/prompt?slug=${encodeURIComponent(params.promptId)}`))
    if (!res.ok) throw notFound()
    const prompt = await res.json()
    if (!prompt) throw notFound()
    return prompt
  },
  component: PromptDetail,
})

function PromptDetail() {
  const router = useRouter()
  const prompt = Route.useLoaderData()

  async function add() {
    await fetch('/api/cart', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'add', promptId: prompt.id }),
    })
    router.navigate({ to: '/cart' })
  }

  return (
    <main className="detail-page">
      <Link to="/" className="backlink">POWERPROMPT Gallery</Link>
      <section className="detail-shell">
        <div className="detail-media"><img src={prompt.imageUrl} alt={prompt.title} /></div>
        <div className="detail-copy">
          <div className="model"><span className="d" />{prompt.model} · {prompt.category}</div>
          <h1>{prompt.title}</h1>
          <p>{prompt.description}</p>
          <div className="detail-stats">
            <span><b>★ {prompt.rating}</b> rating</span>
            <span><b>{prompt.sold.toLocaleString()}</b> sold</span>
            <span><b>{Math.round(prompt.rankScore).toLocaleString()}</b> rank</span>
          </div>
          <div className="checkout-card">
            <div>
              <span className="mono">Creator</span>
              <strong>{prompt.creator}</strong>
            </div>
            <div className="detail-price">{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</div>
            <button className="btn-ink detail-buy" onClick={add}>{prompt.price === 0 ? 'Get it free' : 'Add to Cart'} <Icon name="bag" /></button>
          </div>
        </div>
      </section>
    </main>
  )
}
