import { createFileRoute } from '@tanstack/react-router'
import { serverCartApi } from '../data/server-boundary'
export const Route = createFileRoute('/api/cart')({ server: { handlers: {
  GET: ({ request }) => serverCartApi(request),
  POST: ({ request }) => serverCartApi(request),
  PATCH: ({ request }) => serverCartApi(request),
} } })
