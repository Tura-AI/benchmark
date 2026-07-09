import { Link } from '@tanstack/react-router'
import { Icons } from './icons'
import type { PromptCard } from './types'

const compact = new Intl.NumberFormat('en', { notation: 'compact' })

export function Lightbox({
  prompt,
  onClose,
  onCart,
}: {
  prompt: PromptCard | null
  onClose: () => void
  onCart: (prompt: PromptCard) => void
}) {
  return (
    <div className={`lb ${prompt ? 'open' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {prompt ? (
        <div className="lb-card">
          <button className="lb-close" aria-label="Close preview" onClick={onClose}>
            <Icons.X />
          </button>
          <div className="lb-img">
            <img src={prompt.image} alt={prompt.title} />
          </div>
          <div className="lb-info">
            <div className="model">
              <span className="d" />
              {prompt.model} · {prompt.category}
            </div>
            <h2>{prompt.title}</h2>
            <p className="desc">{prompt.description}</p>
            <div className="stats">
              <div>
                <div className="k">Rating</div>
                <div className="v">★ {prompt.rating}</div>
              </div>
              <div>
                <div className="k">Sold</div>
                <div className="v">{compact.format(prompt.sold)}</div>
              </div>
              <div>
                <div className="k">Seller</div>
                <div className="v">{prompt.creator}</div>
              </div>
            </div>
            <div className="lb-buy">
              <span className={`price ${prompt.price === 0 ? 'free' : ''}`}>
                {prompt.price === 0 ? 'Free' : `$${prompt.price}`}
              </span>
              <button
                className="add"
                onClick={() => {
                  onCart(prompt)
                  onClose()
                }}
              >
                {prompt.price === 0 ? 'Get it free' : 'Add to cart'} <Icons.ChevronRight />
              </button>
              <Link
                to="/prompts/$promptId"
                params={{ promptId: String(prompt.id) }}
                className="ghost-link"
              >
                Details
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
