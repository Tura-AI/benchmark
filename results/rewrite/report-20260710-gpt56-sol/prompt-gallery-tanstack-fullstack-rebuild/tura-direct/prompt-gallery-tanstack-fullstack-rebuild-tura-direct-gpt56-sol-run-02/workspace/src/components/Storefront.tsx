import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { CartSummary, PromptRecord } from '../data/contracts'
import { MODELS } from '../data/contracts'
import { AppShell } from './AppShell'
import { PromptCard } from './PromptCard'
import { PreviewDialog } from './PreviewDialog'
import { Search,ShoppingBag,SlidersHorizontal,X } from './Icons'
import { Toast } from './Toast'

interface Data{prompts:PromptRecord[];categories:{name:string,count:number}[];counts:{total:number;free:number;paid:number;featured:number};cart:CartSummary}
export function Storefront({data,search}:{data:Data;search:Record<string,unknown>}){const navigate=useNavigate({from:'/'});const [searching,setSearching]=useState(Boolean(search.q!==undefined));const [preview,setPreview]=useState<PromptRecord|null>(null);const [hydrated,setHydrated]=useState(false);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const update=(next:Record<string,unknown>)=>navigate({search:{...search,...next}});useEffect(()=>{setHydrated(true);return()=>{if(timer.current)clearTimeout(timer.current)}},[])
  return <div data-hydrated={hydrated}><AppShell cartCount={data.cart.items.length} categories={data.categories} active={search.favorites?'favorites':'home'}><Toast/>
    <header className="catalog-header"><div className="model-tabs" role="group" aria-label="Filter by model">{MODELS.map(model=><button key={model} className={(search.model??'All')===model?'active':''} onClick={()=>update({model:model==='All'?undefined:model})}>{model}</button>)}</div><div className="header-actions">{searching?<label className="search-field"><Search/><input autoFocus defaultValue={String(search.q??'')} placeholder="Search prompts" aria-label="Search prompts" onChange={e=>{if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>update({q:e.target.value||undefined}),250)}}/><button aria-label="Close search" onClick={()=>{setSearching(false);update({q:undefined})}}><X/></button></label>:<button className="icon-button search-toggle" aria-label="Open search" onClick={()=>setSearching(true)}><Search/></button>}<a href="/cart" className="header-cart"><ShoppingBag/><span>Cart</span>{data.cart.items.length>0&&<b>{data.cart.items.length}</b>}</a></div></header>
    <section className="catalog-intro"><div><p className="eyebrow">Curated prompt marketplace</p><h1>{search.favorites?'Your saved prompts':search.category?String(search.category):'Prompts worth keeping.'}</h1><p>{data.prompts.length} results · {data.counts.free} free · {data.counts.paid} paid</p></div><div className="sort-control"><SlidersHorizontal/>{(['featured','newest','popular'] as const).map(sort=><button key={sort} className={(search.sort??'featured')===sort?'active':''} onClick={()=>update({sort})}>{sort[0].toUpperCase()+sort.slice(1)}</button>)}</div></section>
    {data.prompts.length?<section className="masonry" aria-label="Prompt gallery">{data.prompts.map(prompt=><PromptCard key={prompt.id} prompt={prompt} onPreview={setPreview}/>)}</section>:<section className="empty-state"><h2>No prompts found</h2><p>Try another model or clear your search.</p><button className="primary-button" onClick={()=>navigate({search:{}})}>View all prompts</button></section>}
    <PreviewDialog prompt={preview} onClose={()=>setPreview(null)}/>
  </AppShell></div>}
