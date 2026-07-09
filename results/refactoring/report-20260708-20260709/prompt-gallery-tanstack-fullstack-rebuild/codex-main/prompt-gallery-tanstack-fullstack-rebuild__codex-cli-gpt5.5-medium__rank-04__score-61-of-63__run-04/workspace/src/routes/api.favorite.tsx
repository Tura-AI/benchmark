import { createFileRoute } from '@tanstack/react-router'
import { favoriteApi } from '@/server/api'

export const Route = createFileRoute('/api/favorite')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json()
        return Response.json(favoriteApi(Number(body.promptId)))
      },
    },
  },
})
