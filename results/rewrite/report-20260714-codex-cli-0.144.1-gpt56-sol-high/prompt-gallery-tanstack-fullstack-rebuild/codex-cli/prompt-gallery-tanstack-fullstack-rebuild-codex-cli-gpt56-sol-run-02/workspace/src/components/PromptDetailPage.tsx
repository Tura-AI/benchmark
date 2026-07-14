import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { addCartItem, toggleFavorite } from '../data/marketplace.functions'
import type { Prompt } from '../data/types'
import { Icon } from './Icon'
import { MarketplaceShell } from './MarketplaceShell'
import { formatCount } from './PromptPreview'
import { Toast } from './Toast'

export function PromptDetailPage({ initial }: { initial: Prompt }) {
  const [prompt, setPrompt] = useState(initial)
  const [cartCount, setCartCount] = useState(0)
  const [toast, setToast] = useState('')
  const notice = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2200) }
  const add = async () => { const cart = await addCartItem({ data: { promptId: prompt.id } }); setCartCount(cart.count); notice(`Added — ${prompt.title}`) }
  const save = async () => { const result = await toggleFavorite({ data: { promptId: prompt.id } }); setPrompt((p) => ({ ...p, favorite: result.favorite ? 1 : 0 })); notice(result.favorite ? 'Saved to favorites' : 'Removed from favorites') }
  return <MarketplaceShell cartCount={cartCount} onNotice={notice}>
    <div className="detail-page">
      <div className="detail-breadcrumb"><Link to="/">Gallery</Link><span>/</span><span>{prompt.category}</span></div>
      <section className="detail-layout">
        <div className="detail-media" style={{ aspectRatio: prompt.aspectRatio }}><img src={prompt.image} alt={prompt.title} /></div>
        <div className="detail-copy">
          <div className="detail-eyebrow"><span />{prompt.model} · {prompt.category}</div>
          <h1>{prompt.title}</h1><p className="detail-description">{prompt.description}</p>
          <div className="creator-row"><span className="creator-avatar">{prompt.creator.slice(0, 2).toUpperCase()}</span><div><small>Created by</small><b>{prompt.creator}</b><span>{prompt.creatorHandle}</span></div><button onClick={() => notice(`Following ${prompt.creator}`)}>Follow</button></div>
          <div className="prompt-stats wide"><div><span>Rating</span><b>★ {prompt.rating.toFixed(1)}</b></div><div><span>Customers</span><b>{formatCount(prompt.sold)}</b></div><div><span>Updates</span><b>Lifetime</b></div></div>
          <div className="what-you-get"><span className="eyebrow">What you get</span><ul><li><Icon name="check" />Complete prompt framework with editable variables</li><li><Icon name="check" />Model-specific setup notes and examples</li><li><Icon name="check" />Commercial usage and lifetime updates</li></ul></div>
          <div className="detail-purchase"><span className={`detail-price ${prompt.price === 0 ? 'free' : ''}`}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</span><button className="primary-button" onClick={add}>{prompt.price === 0 ? 'Get prompt' : 'Add to cart'} <Icon name="arrow" /></button><button className={`favorite-action ${prompt.favorite ? 'active' : ''}`} aria-label="Favorite prompt" onClick={save}><Icon name="bookmark" /></button></div>
          <p className="purchase-note">Instant access · Secure checkout · 14-day guarantee</p>
        </div>
      </section>
    </div><Toast message={toast} />
  </MarketplaceShell>
}
