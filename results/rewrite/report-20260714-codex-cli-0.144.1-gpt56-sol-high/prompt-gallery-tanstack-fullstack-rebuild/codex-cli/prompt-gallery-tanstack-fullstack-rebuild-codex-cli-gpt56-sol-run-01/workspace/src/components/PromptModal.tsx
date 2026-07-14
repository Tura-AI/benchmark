import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import type { Prompt } from '../lib/types'
import { Icon } from './Icons'

export function PromptModal({ prompt, onClose, onCart, onFavorite }: { prompt: Prompt | null; onClose: () => void; onCart: (p:Prompt)=>void; onFavorite: (p:Prompt)=>void }) {
  useEffect(() => {
    if (!prompt) return
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [prompt, onClose])
  if (!prompt) return null
  return <div className="modal" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="modal__card">
      <button className="modal__close" onClick={onClose} aria-label="Close preview"><Icon name="close" /></button>
      <div className="modal__media"><img src={prompt.imageUrl} alt="" /></div>
      <div className="modal__content"><span className="eyebrow">{prompt.model} · {prompt.category}</span><h2 id="preview-title">{prompt.title}</h2><p>{prompt.description}</p>
        <dl><div><dt>Creator</dt><dd>{prompt.seller}</dd></div><div><dt>Rating</dt><dd>★ {prompt.rating.toFixed(1)}</dd></div><div><dt>Used by</dt><dd>{compact(prompt.sold)}</dd></div></dl>
        <div className="modal__actions"><button className="button button--lime" onClick={() => onCart(prompt)}>{prompt.price ? `Add to Cart · $${prompt.price}` : 'Get free prompt'}</button><button className="icon-button" onClick={() => onFavorite(prompt)} aria-label="Save prompt"><Icon name="bookmark" /></button></div>
        <Link className="text-link" to="/prompts/$promptId" params={{promptId:prompt.slug}}>View full prompt <Icon name="arrow" /></Link>
      </div>
    </div>
  </div>
}

export const compact = (n: number) => n >= 1000 ? `${(n/1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n)
