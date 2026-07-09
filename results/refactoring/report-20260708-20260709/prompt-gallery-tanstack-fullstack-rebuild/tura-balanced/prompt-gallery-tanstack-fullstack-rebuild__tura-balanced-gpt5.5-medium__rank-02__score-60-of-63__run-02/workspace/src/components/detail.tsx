"use client"

import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { getPrompt } from '@/db/queries'
import { addCartAction, toggleFavoriteAction } from '@/server/marketplace'
import { Icon } from './icons'
import { Toast } from './layout'

export function PromptDetail({ prompt }: { prompt: NonNullable<ReturnType<typeof getPrompt>> & { imageUrl?: string } }) {
  const router = useRouter()
  const [toast, setToast] = useState('')
  const show = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2100) }
  return (
    <>
      <article className="detail-card">
        <div className="detail-media"><img src={prompt.imageUrl} alt={prompt.title} /></div>
        <div className="detail-info">
          <span className="model">{prompt.model} · {prompt.category}</span>
          <h1>{prompt.title}</h1>
          <p className="desc">{prompt.description}</p>
          <div className="stats">
            <div className="stat"><div className="k">Rating</div><div className="v">★ {prompt.rating}</div></div>
            <div className="stat"><div className="k">Sold</div><div className="v">{prompt.sold.toLocaleString()}</div></div>
            <div className="stat"><div className="k">Seller</div><div className="v">{prompt.creator}</div></div>
          </div>
          <div className="buy-row">
            <span className={`price ${prompt.priceCents === 0 ? 'free' : ''}`}>{prompt.priceCents === 0 ? 'Free' : `$${prompt.priceCents / 100}`}</span>
            <button className="bm on" aria-label="Favorite" onClick={async () => { await toggleFavoriteAction({ data: { promptId: prompt.id } }); show('Favorite state updated'); router.invalidate() }}><Icon name="heart" /></button>
            <button className="add" onClick={async () => { await addCartAction({ data: { promptId: prompt.id } }); show(`Added — ${prompt.title}`); router.invalidate() }}>{prompt.priceCents === 0 ? 'Get it free' : 'Add to cart'}</button>
          </div>
          <p><Link to="/">Back to gallery</Link></p>
        </div>
      </article>
      <Toast message={toast} />
    </>
  )
}
