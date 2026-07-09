import { createFileRoute } from '@tanstack/react-router'
import { analyticsApi } from '~/data/api'

export const Route = createFileRoute('/api/analytics')({
  server: {
    handlers: {
      GET: async () => analyticsApi(),
    },
  },
})
