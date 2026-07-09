import { createFileRoute } from '@tanstack/react-router'
import { getCart, getFilterCounts, listCategories, listPrompts } from '../server/queries'

export const Route = createFileRoute('/api/catalog')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        return Response.json({
          prompts: listPrompts({
            model: (url.searchParams.get('model') ?? 'all') as never,
            category: url.searchParams.get('category') ?? 'all',
            sort: (url.searchParams.get('sort') ?? 'featured') as never,
            term: url.searchParams.get('term') ?? '',
            favoritesOnly: url.searchParams.get('favorites') === 'true',
          }),
          categories: listCategories(),
          counts: getFilterCounts(),
          cart: getCart(),
        })
      },
    },
  },
})
