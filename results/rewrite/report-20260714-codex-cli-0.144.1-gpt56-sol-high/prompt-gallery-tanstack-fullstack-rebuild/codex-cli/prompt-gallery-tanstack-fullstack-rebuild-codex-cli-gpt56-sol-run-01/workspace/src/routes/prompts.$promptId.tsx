import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icons'
import { Toast } from '../components/Toast'
import { compact } from '../components/PromptModal'
import { getPromptData } from '../server/marketplace.server'

export const Route = createFileRoute('/prompts/$promptId')({
  loader: async ({ params }) => {
    const prompt = await getPromptData({ data: { slug: params.promptId } })
    if (!prompt) throw notFound()
    return prompt
  },
  component: PromptDetail,
})

function PromptDetail() {
  const prompt = Route.useLoaderData()
  const [favorite, setFavorite] = useState(Boolean(prompt.isFavorite))
  const [cartCount, setCartCount] = useState(0)
  const [notice,setNotice] = useState('')
  const toast = (s:string) => {setNotice(s);window.setTimeout(()=>setNotice(''),2200)}
  const add = async () => { const r=await fetch('/api/cart',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({promptId:prompt.id})}); const c=await r.json();setCartCount(c.count);toast(`Added — ${prompt.title}`) }
  const save = async () => {await fetch('/api/favorites',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({promptId:prompt.id})});setFavorite(!favorite);toast(!favorite?'Saved to Favorites':'Removed from Favorites')}
  return <AppShell cartCount={cartCount} onNotice={toast}>
    <main className="detail-page">
      <Link to="/" className="back-link">← Back to gallery</Link>
      <div className="detail-grid">
        <div className="detail-media" style={{'--ratio':prompt.aspect.replace('/',' / ')} as React.CSSProperties}><img src={prompt.imageUrl} alt={prompt.title}/><span>{prompt.model}</span></div>
        <article className="detail-copy"><p className="eyebrow">{prompt.category} · by {prompt.seller}</p><h1>{prompt.title}</h1><p className="lede">{prompt.description}</p>
          <div className="detail-stats"><div><strong>★ {prompt.rating.toFixed(1)}</strong><span>average rating</span></div><div><strong>{compact(prompt.sold)}</strong><span>prompt runs</span></div><div><strong>#{Math.max(1,Math.round(140-prompt.rankScore))}</strong><span>market rank</span></div></div>
          <div className="prompt-sample"><div><span>Prompt preview</span><span>Works with {prompt.model}</span></div><p>{prompt.promptText}</p><div className="prompt-fade">Full prompt unlocked after purchase</div></div>
          <div className="purchase-row"><button className="button button--lime" onClick={add}>{prompt.price ? `Add to Cart · $${prompt.price}` : 'Get this prompt · Free'} <Icon name="arrow" /></button><button className={`save-large ${favorite?'is-active':''}`} onClick={save}><Icon name="bookmark" />{favorite?'Saved':'Save'}</button></div>
          <p className="fine-print"><Icon name="check" /> Instant access · Lifetime updates · 7-day refund policy</p>
        </article>
      </div>
    </main><Toast message={notice}/>
  </AppShell>
}
