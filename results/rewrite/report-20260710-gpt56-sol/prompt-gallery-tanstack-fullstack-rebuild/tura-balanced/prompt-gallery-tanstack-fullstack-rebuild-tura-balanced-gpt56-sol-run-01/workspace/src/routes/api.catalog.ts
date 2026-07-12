import { createFileRoute } from '@tanstack/react-router'
import { catalogResponse } from '~/server/api.server'

export const Route = createFileRoute('/api/catalog')({
  server: { handlers: { GET: ({ request }) => {
    const params = Object.fromEntries(new URL(request.url).searchParams)
    try { return Response.json(catalogResponse(params)) } catch { return Response.json({ error: 'Invalid catalog query' }, { status: 400 }) }
  } } },
})
