import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { PromptRecord } from '../data/contracts'
import { cartFn, favoriteFn } from '../server/marketplace.functions'
import { ArrowUpRight,Check,Heart,Plus,Star } from './Icons'
import { notify } from './Toast'

export function PromptCard({prompt,onPreview}:{prompt:PromptRecord;onPreview:(p:PromptRecord)=>void}){
  const router=useRouter();const [busy,setBusy]=useState(false)
  const mutate=async(kind:'favorite'|'cart')=>{if(busy)return;setBusy(true);try{if(kind==='favorite'){const r=await favoriteFn({data:{promptId:prompt.id}});notify(r.favorite?'Saved to Favorites':'Removed from Favorites')}else{const r=await cartFn({data:{promptId:prompt.id}});notify(r.inCart?'Added to Cart':'Removed from Cart')}await router.invalidate()}finally{setBusy(false)}}
  return <article className="prompt-card" data-testid="prompt-card">
    <button className="media-button" onClick={()=>onPreview(prompt)} aria-label={`Quick view ${prompt.title}`}>
      <img src={prompt.image} alt="" style={{aspectRatio:prompt.aspectRatio}} loading="lazy" width="900" height="1200"/>
      <span className="media-shade"/><span className="model-pill">{prompt.model}</span>
      <span className="quick-view">Preview <ArrowUpRight/></span>
    </button>
    <button className={`favorite-button ${prompt.isFavorite?'saved':''}`} aria-label={prompt.isFavorite?'Remove from favorites':'Save to favorites'} aria-pressed={Boolean(prompt.isFavorite)} onClick={()=>mutate('favorite')} disabled={busy}><Heart fill={prompt.isFavorite?'currentColor':'none'}/></button>
    <div className="card-copy"><div><Link to="/prompts/$promptId" params={{promptId:String(prompt.id)}} className="card-title">{prompt.title}</Link><p>by {prompt.creator} · <Star fill="currentColor"/> {prompt.rating.toFixed(1)}</p></div><button className={`cart-square ${prompt.inCart?'added':''}`} onClick={()=>mutate('cart')} disabled={busy} aria-label={prompt.inCart?'Remove from cart':`Add ${prompt.title} to cart`}>{prompt.inCart?<Check/>:<Plus/>}</button></div>
    <div className="card-foot"><span>{prompt.category}</span><strong>{prompt.price===0?'Free':`$${prompt.price}`}</strong></div>
  </article>
}
