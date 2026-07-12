import { Link, useRouter } from '@tanstack/react-router'
import { ArrowUpRight, Heart, ShoppingBag, Star } from 'lucide-react'
import { useState } from 'react'
import type { Prompt } from '../contracts'
import { cartQuantityFn, favoriteFn } from '../server/functions'
import { useApp } from './AppContext'

export function PromptCard({ prompt }: { prompt: Prompt }) {
  const [favorite, setFavorite] = useState(Boolean(prompt.favorite))
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  const { setCartCount, toast } = useApp()
  async function save() {
    if (busy) return
    setBusy(true)
    const result = await favoriteFn({ data: { promptId: prompt.id } })
    setFavorite(result.favorite); setBusy(false); toast(result.favorite ? 'Saved to Favorites' : 'Removed from Favorites')
    router.invalidate()
  }
  async function add() {
    if (busy) return
    setBusy(true)
    const cart = await cartQuantityFn({ data: { promptId: prompt.id, quantity: 1 } })
    setCartCount(cart.itemCount); setBusy(false); toast(prompt.price === 0 ? 'Free prompt added' : 'Added to Cart')
  }
  return <article className="prompt-card" data-testid="prompt-card">
    <div className="prompt-media" style={{ aspectRatio: prompt.aspect }}>
      <img src={prompt.image} alt={`Preview artwork for ${prompt.title}`} loading="lazy" />
      <div className="card-overlay"><button className={`save ${favorite ? 'active' : ''}`} aria-label={`${favorite ? 'Remove' : 'Add'} ${prompt.title} ${favorite ? 'from' : 'to'} favorites`} aria-pressed={favorite} onClick={save} disabled={busy}><Heart fill={favorite ? 'currentColor' : 'none'} /></button><Link to="/prompts/$promptId" params={{ promptId: String(prompt.id) }} aria-label={`Preview ${prompt.title}`}><ArrowUpRight /></Link></div>
      <button className="quick-add" onClick={add} disabled={busy}><ShoppingBag />{prompt.price === 0 ? 'Get free' : 'Add to Cart'}</button>
    </div>
    <div className="card-info"><div><Link to="/prompts/$promptId" params={{ promptId: String(prompt.id) }}>{prompt.title}</Link><p>{prompt.creator} · {prompt.model}</p></div><div className="card-price"><strong>{prompt.price === 0 ? 'Free' : `$${prompt.price.toFixed(0)}`}</strong><span><Star fill="currentColor" />{prompt.rating}</span></div></div>
  </article>
}
