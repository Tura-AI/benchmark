import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, Check, Heart, ShoppingBag, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cartQuantityFn, promptFn } from '../server/functions'
import { useApp } from '../ui/AppContext'

export const Route = createFileRoute('/prompts/$promptId')({ loader: async ({ params }) => { const prompt = await promptFn({ data: { promptId: Number(params.promptId) } }); if (!prompt) throw notFound(); return prompt }, component: Detail })

function Detail() {
  const prompt = Route.useLoaderData()
  const [busy, setBusy] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const { setCartCount, toast } = useApp()
  useEffect(() => setHydrated(true), [])
  async function add() { setBusy(true); const cart = await cartQuantityFn({ data:{ promptId:prompt.id, quantity:1 } }); setCartCount(cart.itemCount); setBusy(false); toast('Added to Cart') }
  return <main className="detail-page"><Link to="/" className="back"><ArrowLeft />Back to gallery</Link><div className="detail-grid"><div className="detail-image" style={{ aspectRatio: prompt.aspect }}><img src={prompt.image} alt={`Preview artwork for ${prompt.title}`} /></div><section className="detail-copy"><span className="eyebrow">{prompt.category} · {prompt.model}</span><h1>{prompt.title}</h1><div className="rating"><Star fill="currentColor" />{prompt.rating} <span>{prompt.sold.toLocaleString()} sold</span></div><p className="detail-desc">{prompt.description}</p><div className="creator-line"><span>By</span><strong>{prompt.creator}</strong><span>Verified creator</span></div><ul className="included"><li><Check />Complete production prompt</li><li><Check />Usage notes and variables</li><li><Check />Lifetime access</li></ul><div className="detail-buy"><div><span>One-time purchase</span><strong>{prompt.price === 0 ? 'Free' : `$${prompt.price.toFixed(0)}`}</strong></div><button className="primary-button" onClick={add} disabled={!hydrated || busy}><ShoppingBag />{busy ? 'Adding…' : prompt.price === 0 ? 'Get prompt' : 'Add to Cart'}</button></div><button className="text-button"><Heart />Save for later</button></section></div></main>
}
