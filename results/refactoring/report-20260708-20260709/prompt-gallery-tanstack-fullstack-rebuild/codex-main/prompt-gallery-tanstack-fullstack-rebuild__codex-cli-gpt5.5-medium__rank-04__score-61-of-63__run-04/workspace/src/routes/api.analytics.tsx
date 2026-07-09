import { createFileRoute } from '@tanstack/react-router'
import { analyticsApi, storefrontApi } from '@/server/api'

export const Route = createFileRoute('/api/analytics')({
  server: {
    handlers: {
      GET: () => Response.json({ analytics: analyticsApi(), categories: storefrontApi().categories, cart: storefrontApi().cart }),
    },
  },
})
