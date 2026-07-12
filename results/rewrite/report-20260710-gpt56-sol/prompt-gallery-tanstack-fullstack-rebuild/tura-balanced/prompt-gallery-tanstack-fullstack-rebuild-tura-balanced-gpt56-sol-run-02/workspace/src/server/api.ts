import { catalogInputSchema } from '../contracts/marketplace'
import { catalog, getDatabase } from './db'

export function catalogResponse(request: Request) {
  const url = new URL(request.url)
  const parsed = catalogInputSchema.safeParse({
    model: url.searchParams.get('model') || 'all',
    category: url.searchParams.get('category') || 'all',
    sort: url.searchParams.get('sort') || 'featured',
    q: url.searchParams.get('q') || '',
    favorites: url.searchParams.get('favorites') === 'true',
    free: url.searchParams.get('free') === 'true',
  })
  if (!parsed.success) {
    return Response.json({ error: 'Invalid catalog query', issues: parsed.error.issues }, { status: 400 })
  }
  return Response.json(catalog(getDatabase(), parsed.data), {
    headers: { 'Cache-Control': 'private, max-age=30' },
  })
}
