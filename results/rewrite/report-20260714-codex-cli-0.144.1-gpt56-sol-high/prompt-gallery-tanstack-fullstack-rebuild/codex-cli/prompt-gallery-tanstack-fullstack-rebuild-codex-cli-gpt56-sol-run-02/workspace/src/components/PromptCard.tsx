import type { Prompt } from '../data/types'
import { Icon } from './Icon'

export function PromptCard({ prompt, onPreview, onFavorite, onAdd }: { prompt: Prompt; onPreview: (prompt: Prompt) => void; onFavorite: (prompt: Prompt) => void; onAdd: (prompt: Prompt) => void }) {
  return <article className={`prompt-card ${prompt.favorite ? 'saved' : ''}`} data-testid="prompt-card">
    <button className="card-hit" aria-label={`Preview ${prompt.title}`} onClick={() => onPreview(prompt)} />
    <div className="saved-mark"><Icon name="bookmark" /></div>
    <div className="card-media" style={{ aspectRatio: prompt.aspectRatio }}>
      <img src={prompt.image} alt={prompt.title} loading="lazy" width="560" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement?.classList.add('image-fallback') }} />
    </div>
    <div className="card-overlay">
      <div className="overlay-top"><span className="model-pill">{prompt.model}</span><button className={`save-button ${prompt.favorite ? 'on' : ''}`} aria-label={prompt.favorite ? 'Remove from favorites' : 'Save to favorites'} onClick={(e) => { e.stopPropagation(); onFavorite(prompt) }}><Icon name="bookmark" /></button></div>
      <div className="overlay-bottom"><p className="card-category">{prompt.category}</p><h3>{prompt.title}</h3><div className="card-action-row"><span className={`price ${prompt.price === 0 ? 'free' : ''}`}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</span><button className="add-button" onClick={(e) => { e.stopPropagation(); onAdd(prompt) }}>{prompt.price === 0 ? 'Get' : 'Add'} <Icon name="arrow" /></button></div></div>
    </div>
  </article>
}
