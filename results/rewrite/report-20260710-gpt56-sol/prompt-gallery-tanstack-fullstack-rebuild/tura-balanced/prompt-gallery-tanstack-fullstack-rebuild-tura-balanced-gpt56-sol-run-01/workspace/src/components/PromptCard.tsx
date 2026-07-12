import { ArrowRight, Bookmark } from 'lucide-react'
import type { Prompt } from '~/contracts'

export function PromptCard({ prompt, onOpen, onFavorite, onCart }: { prompt: Prompt; onOpen: () => void; onFavorite: () => void; onCart: () => void }) {
  return <article className={`prompt-card ${prompt.isFavorite ? 'prompt-card--saved' : ''}`} style={{ '--ratio': prompt.aspectRatio } as React.CSSProperties}>
    <button className="prompt-card__open" onClick={onOpen} aria-label={`Preview ${prompt.title}`}>
      <img src={prompt.image} alt={prompt.title} loading="lazy" width="640" height="800" />
    </button>
    <div className="prompt-card__saved"><Bookmark fill="currentColor" /></div>
    <div className="prompt-card__overlay" aria-hidden="true">
      <div className="prompt-card__top"><span>{prompt.model}</span><button className={prompt.isFavorite ? 'is-on' : ''} aria-label={prompt.isFavorite ? `Remove ${prompt.title} from favorites` : `Save ${prompt.title}`} onClick={(event) => { event.stopPropagation(); onFavorite() }}><Bookmark fill={prompt.isFavorite ? 'currentColor' : 'none'} /></button></div>
      <div><h2>{prompt.title}</h2><div className="prompt-card__buy"><strong className={prompt.price === 0 ? 'free' : ''}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</strong><button onClick={(event) => { event.stopPropagation(); onCart() }}>Add <ArrowRight /></button></div></div>
    </div>
  </article>
}
