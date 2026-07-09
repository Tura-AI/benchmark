import type { PromptCard } from '../server/types'
import { Icons } from './icons'

export function Lightbox({ prompt, onClose, onCart }: { prompt?: PromptCard; onClose: () => void; onCart: (id: number) => void }) {
  if (!prompt) return null
  const free = prompt.price === 0
  return (
    <div className="lightbox open" role="dialog" aria-modal="true" aria-label={`${prompt.title} detail preview`} onClick={onClose}>
      <div className="lb" onClick={(event) => event.stopPropagation()}>
        <button className="lb__close" type="button" aria-label="Close" onClick={onClose}><Icons.X /></button>
        <div className="lb__img"><img src={prompt.imageUrl} alt={`${prompt.title} expanded preview`} /></div>
        <div className="lb__body">
          <span className="model">{prompt.model} / {prompt.category}</span>
          <h2>{prompt.title}</h2>
          <p>{prompt.description}</p>
          <div className="lb__stats"><span>{prompt.rating.toFixed(1)} rating</span><span>{prompt.sold.toLocaleString()} sold</span><span>{prompt.creator}</span></div>
          <div className="lb__buy"><span className={`price ${free ? 'free' : ''}`}>{free ? 'Free' : `$${prompt.price}`}</span><button className="add" onClick={() => onCart(prompt.id)} type="button">{free ? 'Get it free' : 'Add to cart'} <Icons.Zap /></button></div>
        </div>
      </div>
    </div>
  )
}
