import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, Bookmark, Check, Star } from 'lucide-react'
import { useRef, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { addCartFn, favoriteFn, getCartFn, getPromptFn } from '../server/functions'

export const Route = createFileRoute('/prompts/$promptId')({
  loader: async ({ params }) => {
    const [prompt, cart] = await Promise.all([getPromptFn({ data: { promptId: params.promptId } }), getCartFn()])
    if (!prompt) throw notFound()
    return { prompt, cart }
  },
  component: PromptDetail,
})

const money = (cents: number) => cents ? `$${(cents/100).toFixed(0)}` : 'Free'
function PromptDetail() {
  const { prompt, cart } = Route.useLoaderData()
  const router = useRouter()
  const [toast, setToast] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const notify = (text: string) => { setToast(text); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(''), 2100) }
  const add = async () => { await addCartFn({ data: { promptId: prompt.id } }); await router.invalidate(); notify(`Added — ${prompt.title}`) }
  const save = async () => { await favoriteFn({ data: { promptId: prompt.id } }); await router.invalidate(); notify(prompt.favorite ? 'Removed from favorites' : 'Saved to favorites') }
  return <AppShell cartCount={cart.itemCount}>
    <main className="detail-page">
      <Link to="/" className="back-link"><ArrowLeft />Back to gallery</Link>
      <div className="detail-grid">
        <figure><img src={prompt.image} alt={prompt.title} /></figure>
        <section className="detail-copy"><span className="eyebrow"><i />{prompt.model} · {prompt.category}</span><h1>{prompt.title}</h1><p>{prompt.description}</p>
          <div className="detail-byline"><span>By <strong>{prompt.creatorName}</strong></span><span><Star fill="currentColor" /> {prompt.rating} · {prompt.sold.toLocaleString()} sold</span></div>
          <div className="prompt-includes"><span>Inside this prompt</span><ul><li>Structured prompt framework</li><li>Model-specific setup notes</li><li>Three tested variations</li><li>Commercial use license</li></ul></div>
          <div className="detail-buy"><strong>{money(prompt.priceCents)}</strong><button className={prompt.favorite ? 'saved' : ''} onClick={save}><Bookmark fill={prompt.favorite ? 'currentColor' : 'none'} />{prompt.favorite ? 'Saved' : 'Save'}</button><button className="primary" onClick={add}>{prompt.priceCents ? 'Add to cart' : 'Get it free'}<ArrowRight /></button></div>
        </section>
      </div>
    </main>
    <div className={`toast ${toast ? 'show' : ''}`} role="status"><Check />{toast}</div>
  </AppShell>
}
