import type { DatabaseSync } from 'node:sqlite'
import { addToCart, getCart, listCatalog, toggleFavorite } from './db.server'

export function catalogResponse(db: DatabaseSync, request: Request) {
  const url = new URL(request.url)
  return Response.json(listCatalog(db, {
    model: url.searchParams.get('model') || undefined,
    category: url.searchParams.get('category') || undefined,
    sort: (url.searchParams.get('sort') || 'featured') as 'featured' | 'newest' | 'popular',
    term: url.searchParams.get('q') || undefined,
    favorites: url.searchParams.get('favorites') === 'true',
    free: url.searchParams.get('free') === 'true',
  }))
}

export async function favoriteResponse(db: DatabaseSync, request: Request) {
  const body = await request.json() as { promptId?: number }
  if (!body.promptId) return Response.json({ error: 'promptId is required' }, { status: 400 })
  return Response.json(toggleFavorite(db, body.promptId))
}

export async function cartResponse(db: DatabaseSync, request: Request) {
  if (request.method === 'GET') return Response.json(getCart(db))
  const body = await request.json() as { promptId?: number }
  if (!body.promptId) return Response.json({ error: 'promptId is required' }, { status: 400 })
  return Response.json(addToCart(db, body.promptId), { status: 201 })
}
