import { Link } from '@tanstack/react-router'
import type { Prompt } from '../lib/types'
import { Icon } from './Icons'

export function PromptCard({ prompt, onFavorite, onCart, onPreview }: { prompt: Prompt; onFavorite: (p:Prompt) => void; onCart: (p:Prompt) => void; onPreview: (p:Prompt) => void }) {
  return <article className={`prompt-card ${prompt.isFavorite ? 'is-saved' : ''}`} style={{ '--ratio': prompt.aspect.replace('/', ' / ') } as React.CSSProperties} data-testid="prompt-card">
    {prompt.isFavorite ? <span className="saved-mark"><Icon name="bookmark" /></span> : null}
    <button className="prompt-card__preview" onClick={() => onPreview(prompt)} aria-label={`Preview ${prompt.title}`}>
      <img src={prompt.imageUrl} alt={prompt.title} loading="lazy" onError={(event) => { event.currentTarget.src = '/media/fallback.svg' }} />
    </button>
    <div className="prompt-card__overlay">
      <div className="card-top"><span>{prompt.model}</span><button onClick={() => onFavorite(prompt)} aria-label={prompt.isFavorite ? `Remove ${prompt.title} from favorites` : `Save ${prompt.title}`}><Icon name="bookmark" /></button></div>
      <div className="card-bottom">
        <Link to="/prompts/$promptId" params={{ promptId: prompt.slug }}><h2>{prompt.title}</h2></Link>
        <div><strong className={prompt.price === 0 ? 'is-free' : ''}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</strong><button onClick={() => onCart(prompt)}>Add <Icon name="arrow" /></button></div>
      </div>
    </div>
  </article>
}
