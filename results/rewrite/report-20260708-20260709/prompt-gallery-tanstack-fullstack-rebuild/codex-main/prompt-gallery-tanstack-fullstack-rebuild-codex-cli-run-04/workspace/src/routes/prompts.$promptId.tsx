import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { Bookmark, ShoppingBag } from 'lucide-react'
import { Chrome } from '@/components/Chrome'
import { useToast } from '@/components/useToast'
import { getJson, postJson } from '@/client-api'

export const Route = createFileRoute('/prompts/$promptId')({
  loader: async ({ params }) => {
    const detail = typeof window === 'undefined'
      ? await (async () => {
          const { promptDetailApi, storefrontApi } = await import('@/server/api')
          return { ...promptDetailApi(Number(params.promptId)), categories: storefrontApi().categories }
        })()
      : await getJson<any>(`/api/prompt/${params.promptId}`)
    if (!detail.prompt) throw notFound()
    return detail
  },
  component: PromptDetail,
})

function PromptDetail() {
  const { prompt, cart, categories } = Route.useLoaderData()
  const router = useRouter()
  const toast = useToast()
  async function add() {
    await postJson('/api/cart', { action: 'add', promptId: prompt.id })
    await router.invalidate()
    toast(`Added - ${prompt.title}`)
  }
  async function save() {
    const result = await postJson<{ favorited: boolean }>('/api/favorite', { promptId: prompt.id })
    await router.invalidate()
    toast(result.favorited ? 'Saved to favorites' : 'Removed from favorites')
  }
  return (
    <Chrome categories={categories} cartCount={cart.totals.count}>
      <section className="detail-shell">
        <div className="detail-card">
          <div className="detail-media">
            <img src={prompt.imageUrl} alt={prompt.title} />
          </div>
          <div className="detail-info">
            <div className="model-pill" style={{ alignSelf: 'flex-start', color: '#fff', marginBottom: 12 }}>{prompt.model} · {prompt.category}</div>
            <h1>{prompt.title}</h1>
            <p className="desc">{prompt.description}</p>
            <div className="stat-grid">
              <div className="stat"><div className="k">Rating</div><div className="v">★ {prompt.rating}</div></div>
              <div className="stat"><div className="k">Sold</div><div className="v">{prompt.sold.toLocaleString()}</div></div>
              <div className="stat"><div className="k">Seller</div><div className="v">{prompt.creator}</div></div>
            </div>
            <div className="buy-row">
              <span className="price">{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</span>
              <div className="actions">
                <button className="secondary" onClick={save}><Bookmark size={14} fill={prompt.isFavorite ? 'currentColor' : 'none'} /> Save</button>
                <button className="primary" onClick={add}><ShoppingBag size={14} /> {prompt.price === 0 ? 'Get it free' : 'Add to cart'}</button>
              </div>
            </div>
            <p className="desc"><Link to="/">Back to gallery</Link></p>
          </div>
        </div>
      </section>
    </Chrome>
  )
}
