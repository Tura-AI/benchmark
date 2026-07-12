import { Link, useRouter } from '@tanstack/react-router'
import { ArrowRight, Bookmark, ShoppingBag } from 'lucide-react'
import { useMemo, useState } from 'react'
import type React from 'react'
import { addToCartServer, toggleFavoriteServer } from '../market-api'
import type { PromptCard } from '../types'
import { Price } from './icons'
import { useToast } from './Toast'

function imageUrl(prompt: Pick<PromptCard, 'imageSeed' | 'aspect'>, width = 720) {
  const [w, h] = prompt.aspect.split('/').map(Number)
  return `https://picsum.photos/seed/${prompt.imageSeed}/${width}/${Math.round((width * h) / w)}`
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(n)
}

export function Gallery({ prompts }: { prompts: PromptCard[] }) {
  const columns = useMemo(() => {
    const out: PromptCard[][] = [[], [], [], [], []]
    prompts.forEach((prompt, index) => out[index % out.length].push(prompt))
    return out
  }, [prompts])

  if (!prompts.length) {
    return (
      <div className="empty">
        <div className="big">Nothing here yet</div>
        <div>Try a different filter or search.</div>
      </div>
    )
  }

  return (
    <div className="masonry">
      {columns.map((column, index) => (
        <div className="ms-col" key={index}>
          {column.map((prompt) => (
            <PromptTile key={prompt.id} prompt={prompt} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function PromptTile({ prompt }: { prompt: PromptCard }) {
  const [favorite, setFavorite] = useState(Boolean(prompt.favorite))
  const router = useRouter()
  const { showToast } = useToast()

  async function save(event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    const next = await toggleFavoriteServer({ data: prompt.id })
    setFavorite(next.favorite)
    showToast(next.favorite ? 'Saved to favorites' : 'Removed from favorites')
    router.invalidate()
  }

  async function cart(event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    await addToCartServer({ data: prompt.id })
    showToast(`Added - ${prompt.title}`)
    router.invalidate()
  }

  return (
    <Link className={`tile ${favorite ? 'saved' : ''}`} to="/prompts/$promptId" params={{ promptId: String(prompt.id) }} style={{ '--ar': prompt.aspect } as React.CSSProperties}>
      <div className="savedmark">
        <Bookmark />
      </div>
      <div className="media">
        <img src={imageUrl(prompt)} alt={prompt.title} loading="lazy" />
      </div>
      <div className="ov">
        <div className="ov__top">
          <span className="model">{prompt.model}</span>
          <button className={`bm ${favorite ? 'on' : ''}`} onClick={save} aria-label={favorite ? 'Unsave prompt' : 'Save prompt'}>
            <Bookmark />
          </button>
        </div>
        <div>
          <h3>{prompt.title}</h3>
          <p>{prompt.category} · {prompt.creator} · {fmt(prompt.sold)} sold</p>
          <div className="ov__row">
            <Price price={prompt.price} />
            <button className="add" onClick={cart}>
              Add <ArrowRight />
            </button>
          </div>
        </div>
      </div>
    </Link>
  )
}

export function PromptPreview({ prompt }: { prompt: PromptCard }) {
  const router = useRouter()
  const { showToast } = useToast()
  return (
    <section className="lb open inline">
      <div className="lb__card">
        <div className="lb__img">
          <img src={imageUrl(prompt, 900)} alt={prompt.title} />
        </div>
        <div className="lb__info">
          <div className="model">
            <span className="d" />
            {prompt.model} · {prompt.category}
          </div>
          <h2>{prompt.title}</h2>
          <p className="desc">{prompt.description}</p>
          <div className="stats">
            <div><div className="k">Rating</div><div className="v">★ {prompt.rating}</div></div>
            <div><div className="k">Sold</div><div className="v">{fmt(prompt.sold)}</div></div>
            <div><div className="k">Seller</div><div className="v">{prompt.creator}</div></div>
          </div>
          <div className="lb__buy">
            <Price price={prompt.price} />
            <button
              className="add"
              onClick={async () => {
                await addToCartServer({ data: prompt.id })
                showToast(`Added - ${prompt.title}`)
                router.invalidate()
              }}
            >
              <ShoppingBag /> {prompt.price === 0 ? 'Get it free' : 'Add to cart'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
