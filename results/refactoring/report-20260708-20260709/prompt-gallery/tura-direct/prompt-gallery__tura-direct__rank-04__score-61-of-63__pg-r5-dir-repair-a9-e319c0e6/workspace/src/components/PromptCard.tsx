import { Link } from '@tanstack/react-router'
import type { PromptCard as Card } from '~/data/schema'

export function PromptCard({ prompt, onFavorite, onCart, onPreview }: { prompt: Card; onFavorite: (id: number) => void; onCart: (id: number) => void; onPreview: (p: Card) => void }) {
  return <article className="prompt-card" style={{ aspectRatio: prompt.aspectRatio }}>
    <img src={prompt.image} alt={`${prompt.title} preview`} loading="lazy" />
    <button className={`save ${prompt.isFavorite ? 'on' : ''}`} aria-label={`${prompt.isFavorite ? 'Remove from' : 'Save to'} Favorites`} onClick={() => onFavorite(prompt.id)}>Save</button>
    <div className="overlay"><p className="mono">{prompt.model} / {prompt.category}</p><h2><Link to="/prompt/$slug" params={{ slug: prompt.slug }}>{prompt.title}</Link></h2><p>{prompt.description}</p><div><span>{prompt.priceCents ? `$${(prompt.priceCents / 100).toFixed(0)}` : 'Free'}</span><span>{prompt.sold.toLocaleString()} sold</span><span>{prompt.rating.toFixed(1)}</span></div><footer><button onClick={() => onPreview(prompt)}>Preview</button><button onClick={() => onCart(prompt.id)}>{prompt.inCart ? 'In Cart' : prompt.priceCents ? 'Add to Cart' : 'Get Free'}</button></footer></div>
  </article>
}

export function Lightbox({ prompt, onClose, onCart }: { prompt: Card | null; onClose: () => void; onCart: (id: number) => void }) {
  if (!prompt) return null
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label={prompt.title} onClick={onClose}><section onClick={(e) => e.stopPropagation()}><button className="close" onClick={onClose}>Close</button><img src={prompt.image} alt="" /><div><p className="mono">{prompt.model} / {prompt.category}</p><h1>{prompt.title}</h1><p>{prompt.description}</p><dl><dt>Creator</dt><dd>{prompt.creator}</dd><dt>Rank</dt><dd>{prompt.rankScore}</dd><dt>Sales</dt><dd>{prompt.sold.toLocaleString()}</dd></dl><button className="btn-ink" onClick={() => onCart(prompt.id)}>{prompt.priceCents ? 'Add to Cart' : 'Get Free'}</button></div></section></div>
}
