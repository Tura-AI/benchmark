import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/favorite')({
  server: {
    handlers: {
      POST: async ({ request }) => (await serverApi()).handleFavoriteRequest(request),
    },
  },
})

function serverApi() {
  if (!import.meta.env.SSR) throw new Error('Server API is only available during SSR')
  return import('../server/api.server')
}
