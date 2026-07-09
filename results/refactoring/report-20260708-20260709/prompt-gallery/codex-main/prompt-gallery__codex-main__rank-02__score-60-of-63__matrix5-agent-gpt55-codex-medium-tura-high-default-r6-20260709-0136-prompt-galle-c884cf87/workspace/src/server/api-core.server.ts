import { addToCart, appDb, checkout, getAdminAnalytics, getCart, getCatalog, getPromptBySlug, removeFromCart, toggleFavorite, type CatalogFilters } from './db.server.ts'

const json = (data: unknown, status = 200) => Response.json(data, { status })

export async function handleCatalogRequest(request: Request) {
  const url = new URL(request.url)
  const filters: CatalogFilters = {
    model: url.searchParams.get('model') || undefined,
    category: url.searchParams.get('category') || undefined,
    sort: (url.searchParams.get('sort') as CatalogFilters['sort']) || 'featured',
    term: url.searchParams.get('term') || undefined,
    favorites: url.searchParams.get('favorites') === 'true',
    free: url.searchParams.get('free') === 'true',
  }
  return json(getCatalog(appDb(), filters))
}
export async function handlePromptRequest(request: Request) {
  const slug = new URL(request.url).searchParams.get('slug')
  if (!slug) return json({ error: 'Missing slug' }, 400)
  const prompt = getPromptBySlug(appDb(), slug)
  return prompt ? json(prompt) : json({ error: 'Prompt not found' }, 404)
}
export async function handleCartRequest(request: Request) {
  if (request.method === 'GET') return json(getCart(appDb()))
  const body = await request.json().catch(() => ({})) as { promptId?: number; action?: string }
  if (!body.promptId || !body.action) return json({ error: 'Missing cart action' }, 400)
  if (body.action === 'add') return json(addToCart(appDb(), body.promptId))
  if (body.action === 'remove') return json(removeFromCart(appDb(), body.promptId))
  return json({ error: 'Unsupported cart action' }, 400)
}
export async function handleFavoriteRequest(request: Request) {
  const body = await request.json().catch(() => ({})) as { promptId?: number }
  return body.promptId ? json(toggleFavorite(appDb(), body.promptId)) : json({ error: 'Missing promptId' }, 400)
}
export async function handleCheckoutRequest() { return json(checkout(appDb())) }
export async function handleAdminRequest() { return json(getAdminAnalytics(appDb())) }
