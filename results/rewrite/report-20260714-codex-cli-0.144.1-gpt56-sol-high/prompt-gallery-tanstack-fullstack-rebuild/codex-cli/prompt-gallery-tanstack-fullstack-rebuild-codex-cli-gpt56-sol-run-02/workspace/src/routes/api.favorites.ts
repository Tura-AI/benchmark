import { createFileRoute } from '@tanstack/react-router'
import { serverFavoriteApi } from '../data/server-boundary'
export const Route = createFileRoute('/api/favorites')({ server: { handlers: { POST: ({ request }) => serverFavoriteApi(request) } } })
