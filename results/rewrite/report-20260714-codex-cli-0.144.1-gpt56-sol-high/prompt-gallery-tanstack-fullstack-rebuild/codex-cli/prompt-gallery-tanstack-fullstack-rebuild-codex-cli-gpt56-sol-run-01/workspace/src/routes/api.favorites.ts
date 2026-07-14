import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'

const modules = createServerOnlyFn(async () => ({ api: await import('../server/api.server'), db: await import('../server/db.server') }))

export const Route = createFileRoute('/api/favorites')({
  server: { handlers: { POST: async ({ request }) => { const m = await modules(); return m.api.favoriteResponse(m.db.getDb(), request) } } },
})
