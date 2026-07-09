import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/prompt')({
  server: {
    handlers: {
      GET: async ({ request }) => (await serverApi()).handlePromptRequest(request),
    },
  },
})

function serverApi() {
  if (!import.meta.env.SSR) throw new Error('Server API is only available during SSR')
  return import('../server/api.server')
}
