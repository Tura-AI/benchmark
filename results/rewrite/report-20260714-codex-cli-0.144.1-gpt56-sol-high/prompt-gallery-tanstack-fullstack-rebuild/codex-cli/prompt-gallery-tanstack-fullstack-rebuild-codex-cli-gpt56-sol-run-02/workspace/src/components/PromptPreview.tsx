import { Link } from '@tanstack/react-router'
import type { Prompt } from '../data/types'
import { Icon } from './Icon'

export function PromptPreview({ prompt, onClose, onAdd }: { prompt: Prompt | null; onClose: () => void; onAdd: (prompt: Prompt) => void }) {
  if (!prompt) return null
  return <div className="lightbox open" role="dialog" aria-modal="true" aria-label={`${prompt.title} preview`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="lightbox-card">
      <button className="lightbox-close" aria-label="Close preview" onClick={onClose}><Icon name="close" /></button>
      <div className="lightbox-image" style={{ aspectRatio: prompt.aspectRatio }}><img src={prompt.image} alt={prompt.title} /></div>
      <div className="lightbox-info">
        <div className="detail-eyebrow"><span />{prompt.model} · {prompt.category}</div>
        <h2>{prompt.title}</h2><p className="detail-description">{prompt.description}</p>
        <div className="prompt-stats"><div><span>Rating</span><b>★ {prompt.rating.toFixed(1)}</b></div><div><span>Sold</span><b>{formatCount(prompt.sold)}</b></div><div><span>Seller</span><b>{prompt.creator}</b></div></div>
        <div className="preview-actions"><span className={`detail-price ${prompt.price === 0 ? 'free' : ''}`}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</span><button className="primary-button" onClick={() => onAdd(prompt)}>{prompt.price === 0 ? 'Get it free' : 'Add to cart'} <Icon name="arrow" /></button></div>
        <Link to="/prompts/$slug" params={{ slug: prompt.slug }} className="text-link">View full prompt details →</Link>
      </div>
    </div>
  </div>
}

export const formatCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(n)
