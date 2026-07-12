import { getAnalytics, getCart, getCatalog, getPrompt, type CatalogFilters } from './queries'

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
}

export async function catalogResponse(url: URL) {
  const filters: CatalogFilters = {
    model: (url.searchParams.get('model') as CatalogFilters['model']) ?? 'all',
    category: url.searchParams.get('category') ?? 'all',
    sort: (url.searchParams.get('sort') as CatalogFilters['sort']) ?? 'featured',
    q: url.searchParams.get('q') ?? '',
    favoritesOnly: url.searchParams.get('favorites') === '1',
    freeOnly: url.searchParams.get('free') === '1',
  }
  return json(await getCatalog(filters))
}

export async function promptResponse(id: number) {
  const prompt = await getPrompt(id)
  return prompt ? json(prompt) : json({ error: 'Prompt not found' }, { status: 404 })
}

export async function cartResponse() {
  return json(await getCart())
}

export async function analyticsResponse() {
  return json(await getAnalytics())
}
