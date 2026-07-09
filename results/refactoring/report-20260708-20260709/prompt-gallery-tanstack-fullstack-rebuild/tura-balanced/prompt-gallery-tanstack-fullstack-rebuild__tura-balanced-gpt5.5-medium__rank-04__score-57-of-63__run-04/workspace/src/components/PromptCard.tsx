import { Link } from '@tanstack/react-router'
import type { PromptCard as Prompt } from '../server/types'
import { Icons } from './icons'

export function PromptCard({ prompt, onFavorite, onCart, onPreview }: { prompt: Prompt; onFavorite: (id: number) => void; onCart: (id: number) => void; onPreview: (prompt: Prompt) => void }) {
  const free = prompt.price === 0
  return (
    <article
      className={`tile ${prompt.isFavorite ? 'saved' : ''}`}
      style={{ '--ar': prompt.aspectRatio } as React.CSSProperties}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (!target.closest('button,a')) onPreview(prompt)
      }}
    >
      <button className={`savedmark ${prompt.isFavorite ? 'on' : ''}`} aria-label={`Save ${prompt.title}`} onClick={() => onFavorite(prompt.id)} type="button"><Icons.Bookmark /></button>
      <button
        className="imageButton"
        onClick={(event) => {
          event.stopPropagation()
          onPreview(prompt)
        }}
        onPointerDown={(event) => {
          if (event.pointerType === 'touch') onPreview(prompt)
        }}
        type="button"
        aria-label={`Preview ${prompt.title}`}
      >
        <img src={prompt.imageUrl} alt={`${prompt.title} prompt preview`} loading="lazy" />
      </button>
      <div className="ov">
        <div className="ov__top"><span className="model">{prompt.model}</span><span className="rating"><Icons.Star fill="currentColor" /> {prompt.rating.toFixed(1)}</span></div>
        <h3>{prompt.title}</h3>
        <p>{prompt.description}</p>
        <div className="meta"><span>{prompt.category}</span><span>{formatSold(prompt.sold)} sold</span></div>
        <div className="ov__bottom">
          <span className={`price ${free ? 'free' : ''}`}>{free ? 'Free' : `$${prompt.price}`}</span>
          <button className="add" type="button" onClick={() => onCart(prompt.id)}>{free ? 'Get' : 'Add'} <Icons.Zap size={12} /></button>
        </div>
        <Link className="detail-link" to="/prompts/$slug" params={{ slug: prompt.slug }}>Open detail</Link>
      </div>
    </article>
  )
}

function formatSold(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1).replace('.0', '')}k` : String(value)
}
