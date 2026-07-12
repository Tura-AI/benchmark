import { createFileRoute } from '@tanstack/react-router'
import { catalogInput } from '../contracts'
import { getDatabase } from '../server/db'
import { getCatalog } from '../server/queries'

export const Route = createFileRoute('/api/prompts')({ server: { handlers: { GET: ({ request }) => { const url=new URL(request.url); const parsed=catalogInput.safeParse({model:url.searchParams.get('model') ?? 'all',category:url.searchParams.get('category') ?? 'all',sort:url.searchParams.get('sort') ?? 'featured',search:url.searchParams.get('search') ?? '',favorites:url.searchParams.get('favorites')==='true',free:url.searchParams.get('free')==='true'}); return parsed.success ? Response.json(getCatalog(getDatabase(),parsed.data)) : Response.json({error:parsed.error.flatten()},{status:400}) } } } })
