import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icons } from '../components/icons'
import { Toast } from '../components/Toast'
import { addToCartFn, getCatalogFn, getPromptFn, toggleFavoriteFn } from '../server/functions'

export const Route = createFileRoute('/prompts/$slug')({
  loader: async ({ params }) => {
    const [prompt, catalog] = await Promise.all([getPromptFn({ data: { slug: params.slug } }), getCatalogFn({ data: {} })])
    if (!prompt) throw notFound()
    return { prompt, catalog }
  },
  component: PromptDetail,
})

function PromptDetail() {
  const router = useRouter()
  const { prompt, catalog } = Route.useLoaderData()
  const [toast, setToast] = useState('')
  async function favorite() {
    const result = await toggleFavoriteFn({ data: { promptId: prompt.id } })
    setToast(result.isFavorite ? 'Saved to favorites' : 'Removed from favorites')
    await router.invalidate()
  }
  async function cart() {
    await addToCartFn({ data: { promptId: prompt.id } })
    setToast('Added to Cart')
    await router.invalidate()
  }
  return (
    <div className="app detail-app">
      <AppShell categories={catalog.categories} cartCount={catalog.cart.totals.itemCount} />
      <main className="detail-main">
        <Link className="back" to="/">Back to Featured</Link>
        <section className="detail-grid">
          <img className="detail-img" src={prompt.imageUrl} alt={`${prompt.title} prompt preview`} />
          <div className="detail-copy">
            <span className="model">{prompt.model} / {prompt.category}</span>
            <h1>{prompt.title}</h1>
            <p>{prompt.description}</p>
            <div className="detail-stats"><span>{prompt.rating.toFixed(1)} rating</span><span>{prompt.sold.toLocaleString()} sold</span><span>{prompt.creator}</span></div>
            <div className="detail-actions"><button onClick={favorite} type="button"><Icons.Heart /> {prompt.isFavorite ? 'Saved' : 'Save'}</button><button className="primary" onClick={cart} type="button">{prompt.price === 0 ? 'Get it free' : `Add to Cart $${prompt.price}`}</button></div>
          </div>
        </section>
      </main>
      <Toast message={toast} />
    </div>
  )
}
