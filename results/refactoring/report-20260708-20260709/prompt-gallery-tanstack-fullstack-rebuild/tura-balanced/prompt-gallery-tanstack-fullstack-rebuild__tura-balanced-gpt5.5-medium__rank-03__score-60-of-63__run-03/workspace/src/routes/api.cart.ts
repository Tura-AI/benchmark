import { createFileRoute } from '@tanstack/react-router'
import { cartApi } from '~/data/api'

export const Route = createFileRoute('/api/cart')({
  server: {
    handlers: {
      GET: async ({ request }) => cartApi(request),
      POST: async ({ request }) => cartApi(request),
      DELETE: async ({ request }) => cartApi(request),
    },
  },
})
