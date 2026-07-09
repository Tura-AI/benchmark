import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '@/components/layout'
import { Storefront } from '@/components/storefront'
import { getStorefront } from '@/server/marketplace'

type Search = {
  model?: string
  category?: string
  sort?: 'featured' | 'newest' | 'popular'
  q?: string
  favorites?: boolean
  free?: boolean
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    model: typeof search.model === 'string' ? search.model : 'all',
    category: typeof search.category === 'string' ? search.category : 'all',
    sort: search.sort === 'newest' || search.sort === 'popular' ? search.sort : 'featured',
    q: typeof search.q === 'string' ? search.q : undefined,
    favorites: search.favorites === true || search.favorites === 'true',
    free: search.free === true || search.free === 'true',
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => getStorefront({ data: { model: deps.model, category: deps.category, sort: deps.sort, q: deps.q, favoritesOnly: deps.favorites, freeOnly: deps.free } }),
  component: Home,
})

function Home() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  return <Shell categories={data.categories} cartCount={data.cart.count}><Storefront prompts={data.prompts} counts={data.counts} searchState={search} /></Shell>
}
