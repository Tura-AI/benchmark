import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Icons } from '../../components/icons'
import { Toast } from '../../components/Toast'
import type { Toast as ToastType } from '../../components/types'
import { addToCartFn, getPromptDetail, toggleFavoriteFn } from '../../server/market'

export const Route = createFileRoute('/prompts/$promptId')({
  loader: ({ params }) => ({ promptId: Number(params.promptId) }),
  component: PromptDetail,
})

function PromptDetail() {
  const initial = Route.useLoaderData()
  const [prompt, setPrompt] = useState<any>(null)
  const [toast, setToast] = useState<ToastType | null>(null)

  useEffect(() => {
    getPromptDetail({ data: { promptId: initial.promptId } }).then((result) => {
      if (!result) throw notFound()
      setPrompt(result)
    })
  }, [initial.promptId])

  if (!prompt) return <main className="detail-page">Loading prompt...</main>

  return (
    <main className="detail-page">
      <Link to="/" className="back-link">
        <Icons.ChevronRight /> Back to gallery
      </Link>
      <section className="detail-layout">
        <div className="detail-media">
          <img src={prompt.image} alt={prompt.title} />
        </div>
        <div className="detail-copy">
          <p className="mono kicker">{prompt.model} · {prompt.category}</p>
          <h1>{prompt.title}</h1>
          <p>{prompt.description}</p>
          <div className="detail-stats">
            <span>★ {prompt.rating}</span>
            <span>{prompt.sold.toLocaleString()} sold</span>
            <span>Rank {prompt.rankScore}</span>
            <span>{prompt.creator}</span>
          </div>
          <div className="detail-actions">
            <strong className={prompt.price === 0 ? 'free-price' : ''}>
              {prompt.price === 0 ? 'Free' : `$${prompt.price}`}
            </strong>
            <button
              className="btn-ink"
              onClick={async () => {
                await addToCartFn({ data: { promptId: prompt.id } })
                setToast({ text: 'Added to Cart' })
              }}
            >
              Add to Cart
            </button>
            <button
              className="outline-btn"
              onClick={async () => {
                const result = await toggleFavoriteFn({ data: { promptId: prompt.id } })
                setPrompt({ ...prompt, isFavorite: result.isFavorite ? 1 : 0 })
                setToast({ text: result.isFavorite ? 'Saved to Favorites' : 'Favorite removed' })
              }}
            >
              {prompt.isFavorite ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </section>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </main>
  )
}
