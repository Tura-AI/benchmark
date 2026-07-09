import { createFileRoute } from '@tanstack/react-router'
import { getAnalytics } from '../server/queries'

export const Route = createFileRoute('/api/analytics')({
  server: {
    handlers: {
      GET: () => Response.json(getAnalytics()),
    },
  },
})
