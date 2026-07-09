import { Link, useRouter } from '@tanstack/react-router'
import { Bookmark, ArrowRight } from 'lucide-react'
import { useToast } from './useToast'
import type { PromptRow } from '@/server/db'
import { postJson } from '@/client-api'

export function PromptCard({ prompt }: { prompt: PromptRow }) {
  const router = useRouter()
  const toast = useToast()
  async function save(event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    const result = await postJson<{ favorited: boolean }>('/api/favorite', { promptId: prompt.id })
    await router.invalidate()
    toast(result.favorited ? 'Saved to favorites' : 'Removed from favorites')
  }
  async function add(event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    await postJson('/api/cart', { action: 'add', promptId: prompt.id })
    await router.invalidate()
    toast(`Added - ${prompt.title}`)
  }
  return (
    <Link className="tile" to="/prompts/$promptId" params={{ promptId: String(prompt.id) }} style={{ '--ar': prompt.aspectRatio.replace('/', ' / ') } as React.CSSProperties}>
      {prompt.isFavorite ? <span className="savedmark"><Bookmark size={14} fill="currentColor" /></span> : null}
      <div className="media">
        <img src={prompt.imageUrl} alt={prompt.title} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} />
        <div className="fallback" aria-hidden="true">{prompt.title.charAt(0)}</div>
      </div>
      <div className="overlay">
        <div className="overlay-top">
          <span className="model-pill">{prompt.model}</span>
          <button className={`save-btn ${prompt.isFavorite ? 'on' : ''}`} aria-label="Save" onClick={save}>
            <Bookmark size={15} fill={prompt.isFavorite ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div>
          <h3>{prompt.title}</h3>
          <div className="overlay-row">
            <span className={`price ${prompt.price === 0 ? 'free' : ''}`}>{prompt.price === 0 ? 'Free' : `$${prompt.price}`}</span>
            <button className="add-btn" onClick={add}>Add <ArrowRight size={12} /></button>
          </div>
        </div>
      </div>
    </Link>
  )
}
