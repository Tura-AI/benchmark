import { Link } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { Icons } from './icons'
import type { PromptCard } from './types'

const fmt = new Intl.NumberFormat('en', { notation: 'compact' })

export function PromptTile({
  prompt,
  onPreview,
  onFavorite,
  onCart,
}: {
  prompt: PromptCard
  onPreview: (prompt: PromptCard) => void
  onFavorite: (prompt: PromptCard) => void
  onCart: (prompt: PromptCard) => void
}) {
  return (
    <article
      className={`tile ${prompt.isFavorite ? 'saved' : ''}`}
      style={{ '--ar': prompt.aspect } as CSSProperties}
    >
      <button
        className="tile-hit"
        aria-label={`Preview ${prompt.title}`}
        onClick={() => onPreview(prompt)}
      />
      <div className="savedmark">
        <Icons.Bookmark fill="currentColor" />
      </div>
      <div className="media">
        <img src={prompt.image} alt={prompt.title} loading="lazy" />
      </div>
      <div className="ov">
        <div className="ov-top">
          <span className="model">{prompt.model}</span>
          <button
            className={`bm ${prompt.isFavorite ? 'on' : ''}`}
            aria-label={`Save ${prompt.title}`}
            onClick={() => onFavorite(prompt)}
          >
            <Icons.Bookmark fill={prompt.isFavorite ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div>
          <h3>{prompt.title}</h3>
          <div className="mini-meta">
            <span>{prompt.creator}</span>
            <span>{fmt.format(prompt.sold)} sold</span>
          </div>
          <div className="ov-row">
            <span className={`price ${prompt.price === 0 ? 'free' : ''}`}>
              {prompt.price === 0 ? 'Free' : `$${prompt.price}`}
            </span>
            <button className="add" onClick={() => onCart(prompt)}>
              Add <Icons.ChevronRight />
            </button>
          </div>
          <Link
            className="detail-link"
            to="/prompts/$promptId"
            params={{ promptId: String(prompt.id) }}
          >
            View detail
          </Link>
        </div>
      </div>
    </article>
  )
}
