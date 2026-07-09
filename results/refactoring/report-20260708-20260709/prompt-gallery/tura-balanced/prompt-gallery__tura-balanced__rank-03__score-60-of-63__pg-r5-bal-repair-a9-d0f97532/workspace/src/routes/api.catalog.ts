import { createFileRoute } from '@tanstack/react-router'
import { catalogApi } from '~/data/api'

export const Route = createFileRoute('/api/catalog')({
  server: {
    handlers: {
      GET: async ({ request }) => catalogApi(request),
    },
  },
})
