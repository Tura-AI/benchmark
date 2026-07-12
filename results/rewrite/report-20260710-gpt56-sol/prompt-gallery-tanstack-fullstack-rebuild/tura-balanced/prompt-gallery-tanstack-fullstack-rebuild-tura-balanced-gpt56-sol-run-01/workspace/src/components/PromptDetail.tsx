import { ArrowLeft, ArrowRight, Bookmark, Star, X } from 'lucide-react'
import { useState } from 'react'
import type { Prompt } from '~/contracts'
import { addPromptToCart, favoritePrompt } from '~/server/marketplace.functions'

export function PromptDetail({ prompt: initial, page = false, onClose, onChanged }: { prompt: Prompt; page?: boolean; onClose?: () => void; onChanged?: () => void }) {
  const [prompt, setPrompt] = useState(initial)
  const [busy, setBusy] = useState(false)
  const favorite = async () => { setBusy(true); const result = await favoritePrompt({ data: { promptId: prompt.id } }); setPrompt({ ...prompt, isFavorite: result.favorite }); setBusy(false); onChanged?.() }
  const add = async () => { setBusy(true); await addPromptToCart({ data: { promptId: prompt.id, quantity: 1 } }); setBusy(false); onChanged?.() }
  const content = <section className="detail-card" aria-label={`${prompt.title} details`}>
    {page ? <a className="detail-card__back" href="/"><ArrowLeft />Gallery</a> : <button className="detail-card__close" onClick={onClose} aria-label="Close preview"><X /></button>}
    <div className="detail-card__media"><img src={prompt.image} alt={prompt.title} /></div>
    <div className="detail-card__info">
      <p className="eyebrow"><span />{prompt.model} · {prompt.category}</p>
      <h1>{prompt.title}</h1><p className="detail-card__desc">{prompt.description}</p>
      <dl className="detail-stats"><div><dt>Rating</dt><dd><Star fill="currentColor" />{prompt.rating}</dd></div><div><dt>Sold</dt><dd>{prompt.sold.toLocaleString()}</dd></div><div><dt>Seller</dt><dd>{prompt.creator}</dd></div></dl>
      <div className="detail-actions"><strong className={prompt.price === 0 ? 'free' : ''}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</strong><button className="save-button" disabled={busy} onClick={favorite}><Bookmark fill={prompt.isFavorite ? 'currentColor' : 'none'} />{prompt.isFavorite ? 'Saved' : 'Save'}</button><button className="buy-button" disabled={busy} onClick={add}>{prompt.price === 0 ? 'Get free' : 'Add to cart'}<ArrowRight /></button></div>
    </div>
  </section>
  return page ? <main className="detail-page">{content}</main> : <div className="lightbox" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose?.() }}>{content}</div>
}
