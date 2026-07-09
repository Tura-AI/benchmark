import { createFileRoute } from '@tanstack/react-router'
import { MarketplaceApp } from '~/ui/MarketplaceApp'
import { loadStorefront } from '~/data/server'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => ({
    model: typeof search.model === 'string' ? search.model : 'all',
    category: typeof search.category === 'string' ? search.category : 'all',
    sort: search.sort === 'newest' || search.sort === 'popular' ? search.sort : 'featured',
    q: typeof search.q === 'string' ? search.q : '',
    favorites: search.favorites === true || search.favorites === 'true',
    free: search.free === true || search.free === 'true',
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadStorefront({ data: deps }),
  component: Storefront,
})

function Storefront() {
  const data = Route.useLoaderData()
  return <MarketplaceApp data={data} />
}
