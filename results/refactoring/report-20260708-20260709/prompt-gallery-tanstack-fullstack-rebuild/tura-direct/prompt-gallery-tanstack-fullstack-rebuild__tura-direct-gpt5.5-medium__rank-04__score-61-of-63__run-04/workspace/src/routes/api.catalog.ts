import { createFileRoute } from '@tanstack/react-router'
import { getCounts, listPrompts } from '~/data/db'

export const Route = createFileRoute('/api/catalog')({ server: { handlers: { GET: ({ request }) => { const url = new URL(request.url); return Response.json({ prompts: listPrompts({ model: (url.searchParams.get('model') || 'All') as any, sort: (url.searchParams.get('sort') || 'Featured') as any, term: url.searchParams.get('term') || '' }), counts: getCounts(1) }) } } } })
