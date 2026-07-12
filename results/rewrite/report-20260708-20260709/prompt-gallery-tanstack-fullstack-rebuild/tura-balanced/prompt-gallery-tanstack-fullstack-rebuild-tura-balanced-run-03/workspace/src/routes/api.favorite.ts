import { createFileRoute } from '@tanstack/react-router'
import { favoriteApi } from '~/data/api'

export const Route = createFileRoute('/api/favorite')({
  server: {
    handlers: {
      POST: async ({ request }) => favoriteApi(request),
    },
  },
})
