import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/catalog')({
  server: {
    handlers: {
      GET: async ({ request }) => (await serverApi()).handleCatalogRequest(request),
    },
  },
})

function serverApi() {
  if (!import.meta.env.SSR) throw new Error('Server API is only available during SSR')
  return import('../server/api.server')
}
