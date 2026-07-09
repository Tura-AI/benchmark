import { createFileRoute } from '@tanstack/react-router'
import { storefrontApi } from '@/server/api'

export const Route = createFileRoute('/api/storefront')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        const data = storefrontApi({
          model: url.searchParams.get('model') ?? 'all',
          category: url.searchParams.get('category') ?? 'all',
          sort: url.searchParams.get('sort') ?? 'featured',
          search: url.searchParams.get('search') ?? '',
          favoritesOnly: url.searchParams.get('favoritesOnly') === 'true',
          freeOnly: url.searchParams.get('freeOnly') === 'true',
        })
        return Response.json(data)
      },
    },
  },
})
