import { createFileRoute } from '@tanstack/react-router'
import { checkoutApi } from '~/data/api'

export const Route = createFileRoute('/api/checkout')({
  server: {
    handlers: {
      POST: async () => checkoutApi(),
    },
  },
})
