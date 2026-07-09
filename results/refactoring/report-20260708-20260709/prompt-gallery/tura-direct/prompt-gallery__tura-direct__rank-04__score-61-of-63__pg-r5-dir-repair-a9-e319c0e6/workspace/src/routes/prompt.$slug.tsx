import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect, useState, useTransition } from 'react'
import { cartAdd, favoritePrompt, fetchPrompt } from '~/data/server'

export const Route = createFileRoute('/prompt/$slug')({ loader: async ({ params }) => { const prompt = await fetchPrompt({ data: { slug: params.slug } }); if (!prompt) throw notFound(); return prompt }, component: Detail })

function Detail() {
  const p = Route.useLoaderData()
  const [msg, setMsg] = useState('')
  const [ready, setReady] = useState(false)
  const [, start] = useTransition()
  useEffect(() => setReady(true), [])
  return <main className="detail"><Link to="/" search={{ category: 'All' }} className="back">POWERPROMPT</Link><img src={p.image} alt={`${p.title} preview`} /><section><p className="mono">{p.model} / {p.category}</p><h1>{p.title}</h1><p>{p.description}</p><dl><dt>Creator</dt><dd>{p.creator}</dd><dt>Rank score</dt><dd>{p.rankScore}</dd><dt>Price</dt><dd>{p.priceCents ? `$${(p.priceCents / 100).toFixed(0)}` : 'Free'}</dd><dt>Sales</dt><dd>{p.sold.toLocaleString()}</dd></dl><div className="actions"><button disabled={!ready} onClick={() => start(async () => { await favoritePrompt({ data: { promptId: p.id } }); setMsg('Favorites updated') })}>Save to Favorites</button><button disabled={!ready} className="btn-ink" onClick={() => { setMsg('Added to Cart'); start(async () => { await cartAdd({ data: { promptId: p.id } }) }) }}>Add to Cart</button></div>{msg ? <p className="status">{msg}</p> : null}</section></main>
}
