import { addToCart, checkout, getAnalytics, getCartSummary, getStorefront, removeFromCart, toggleFavorite } from './db'

export async function catalogApi(request: Request) {
  const url = new URL(request.url)
  return Response.json(getStorefront({
    model: url.searchParams.get('model') ?? 'all',
    category: url.searchParams.get('category') ?? 'all',
    sort: (url.searchParams.get('sort') as 'featured' | 'newest' | 'popular' | null) ?? 'featured',
    q: url.searchParams.get('q') ?? '',
    favorites: url.searchParams.get('favorites') === 'true',
    free: url.searchParams.get('free') === 'true',
  }))
}

export async function cartApi(request: Request) {
  if (request.method === 'GET') return Response.json(getCartSummary())
  if (request.method === 'POST') {
    const body = await request.json()
    return Response.json(addToCart(Number(body.promptId)))
  }
  if (request.method === 'DELETE') {
    const url = new URL(request.url)
    return Response.json(removeFromCart(Number(url.searchParams.get('promptId'))))
  }
  return new Response('Method not allowed', { status: 405 })
}

export async function favoriteApi(request: Request) {
  const body = await request.json()
  return Response.json(toggleFavorite(Number(body.promptId)))
}

export async function checkoutApi() {
  return Response.json(checkout())
}

export async function analyticsApi() {
  return Response.json(getAnalytics())
}
