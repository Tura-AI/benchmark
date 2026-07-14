import { createFileRoute } from '@tanstack/react-router'
import { serverCatalogApi } from '../data/server-boundary'
export const Route = createFileRoute('/api/catalog')({ server: { handlers: { GET: ({ request }) => serverCatalogApi(request) } } })
