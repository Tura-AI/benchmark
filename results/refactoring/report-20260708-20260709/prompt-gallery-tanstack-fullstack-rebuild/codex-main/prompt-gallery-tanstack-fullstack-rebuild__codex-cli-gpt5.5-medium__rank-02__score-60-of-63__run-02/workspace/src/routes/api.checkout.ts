import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/checkout')({
  server: {
    handlers: {
      POST: async () => (await serverApi()).handleCheckoutRequest(),
    },
  },
})

function serverApi() {
  if (!import.meta.env.SSR) throw new Error('Server API is only available during SSR')
  return import('../server/api.server')
}
