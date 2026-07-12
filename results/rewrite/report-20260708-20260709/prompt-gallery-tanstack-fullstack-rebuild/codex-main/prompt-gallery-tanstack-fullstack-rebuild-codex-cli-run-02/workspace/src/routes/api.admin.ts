import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/admin')({
  server: {
    handlers: {
      GET: async () => (await serverApi()).handleAdminRequest(),
    },
  },
})

function serverApi() {
  if (!import.meta.env.SSR) throw new Error('Server API is only available during SSR')
  return import('../server/api.server')
}
