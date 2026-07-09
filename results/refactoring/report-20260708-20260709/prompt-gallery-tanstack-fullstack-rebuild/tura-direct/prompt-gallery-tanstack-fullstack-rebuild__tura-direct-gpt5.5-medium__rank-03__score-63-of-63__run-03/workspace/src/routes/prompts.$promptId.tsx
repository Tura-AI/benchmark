import { Link, createFileRoute } from '@tanstack/react-router'
import { Dock, Sidebar } from './__root'
import { fetchCatalog, fetchPrompt, putCart } from '../lib/serverFns'

export const Route = createFileRoute('/prompts/$promptId')({ loader: async ({ params }) => ({ prompt: await fetchPrompt({ data: { id: params.promptId } }), shell: await fetchCatalog({ data: {} }) }), component: PromptDetail })
function money(c: number) { return c ? `$${(c / 100).toFixed(0)}` : 'Free' }
function PromptDetail() {
  const { prompt, shell } = Route.useLoaderData() as any
  if (!prompt) return <div className="app"><Sidebar categories={shell.categories} counts={shell.counts} /><main className="main"><div className="empty">Prompt not found.</div></main></div>
  return <div className="app"><Sidebar categories={shell.categories} counts={shell.counts} /><main className="main"><div className="topbar"><Link className="ghost" to="/">Back to gallery</Link></div><section className="detail"><div className="bigmedia" style={{ '--a': prompt.a, '--b': prompt.b } as any}><img src={prompt.image} alt="" /></div><article className="panel"><p className="mono">{prompt.model} / {prompt.category}</p><h1>{prompt.title}</h1><p>{prompt.summary}</p><div className="row"><span>Creator</span><strong>{prompt.creator} {prompt.handle}</strong></div><div className="row"><span>Rating</span><strong>{prompt.rating}</strong></div><div className="row"><span>Sales</span><strong>{prompt.sales}</strong></div><button className="lime" onClick={() => putCart({ data: { id: prompt.id } })}>{prompt.price_cents ? `Add to Cart - ${money(prompt.price_cents)}` : 'Get it free'}</button></article></section></main><Dock /></div>
}
