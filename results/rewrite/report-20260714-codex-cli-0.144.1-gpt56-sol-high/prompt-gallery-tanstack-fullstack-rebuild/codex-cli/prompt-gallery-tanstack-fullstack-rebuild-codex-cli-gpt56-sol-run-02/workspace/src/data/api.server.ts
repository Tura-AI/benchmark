import { getDb, type MarketplaceDb } from './db.server'
import type { SortKey } from './types'

export function jsonError(message: string, status = 400) { return Response.json({ error: message }, { status }) }

export function handleCatalogRequest(request: Request, db: MarketplaceDb = getDb()) {
  const url = new URL(request.url)
  const sort = url.searchParams.get('sort') as SortKey | null
  if (sort && !['featured', 'newest', 'popular'].includes(sort)) return jsonError('Invalid sort value')
  return Response.json(db.listCatalog({
    model: url.searchParams.get('model') || undefined,
    category: url.searchParams.get('category') || undefined,
    search: url.searchParams.get('q') || undefined,
    sort: sort || 'featured',
    favorites: url.searchParams.get('favorites') === 'true',
    price: (url.searchParams.get('price') as 'all' | 'free' | 'paid' | null) || 'all',
  }))
}

export async function handleCartRequest(request: Request, db: MarketplaceDb = getDb()) {
  if (request.method === 'GET') return Response.json(db.getCart())
  try {
    const body = await request.json() as { promptId?: number; quantity?: number }
    if (!Number.isInteger(body.promptId)) return jsonError('promptId must be an integer')
    if (request.method === 'POST') return Response.json(db.addToCart(body.promptId!))
    if (request.method === 'PATCH') {
      if (!Number.isInteger(body.quantity)) return jsonError('quantity must be an integer')
      return Response.json(db.setCartQuantity(body.promptId!, body.quantity!))
    }
    return jsonError('Method not allowed', 405)
  } catch { return jsonError('Invalid JSON body') }
}

export function handleCheckoutRequest(db: MarketplaceDb = getDb()) {
  try { return Response.json(db.checkout(), { status: 201 }) }
  catch (error) { return jsonError(error instanceof Error ? error.message : 'Checkout failed', 409) }
}

export function handleFavoriteRequest(request: Request, db: MarketplaceDb = getDb()) {
  return request.json().then((body: { promptId?: number }) => {
    if (!Number.isInteger(body.promptId)) return jsonError('promptId must be an integer')
    return Response.json(db.toggleFavorite(body.promptId!))
  }).catch(() => jsonError('Invalid JSON body'))
}
