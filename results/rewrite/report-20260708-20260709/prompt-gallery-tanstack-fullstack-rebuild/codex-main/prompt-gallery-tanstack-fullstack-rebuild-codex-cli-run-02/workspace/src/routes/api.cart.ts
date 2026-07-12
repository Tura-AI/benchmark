import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/cart')({
  server: {
    handlers: {
      GET: async ({ request }) => (await serverApi()).handleCartRequest(request),
      POST: async ({ request }) => (await serverApi()).handleCartRequest(request),
    },
  },
})

function serverApi() {
  if (!import.meta.env.SSR) throw new Error('Server API is only available during SSR')
  return import('../server/api.server')
}
