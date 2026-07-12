import { createFileRoute } from '@tanstack/react-router'
import { Chrome } from '@/components/Chrome'
import { PromptCard } from '@/components/PromptCard'
import { TopFilters } from '@/components/TopFilters'
import { getJson } from '@/client-api'

type StoreSearch = {
  model?: string
  category?: string
  sort?: string
  search?: string
  favoritesOnly?: boolean
  freeOnly?: boolean
  searchOpen?: boolean
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): StoreSearch => ({
    model: String(search.model ?? 'all'),
    category: String(search.category ?? 'all'),
    sort: String(search.sort ?? 'featured'),
    search: String(search.search ?? ''),
    favoritesOnly: search.favoritesOnly === true || search.favoritesOnly === 'true',
    freeOnly: search.freeOnly === true || search.freeOnly === 'true',
    searchOpen: search.searchOpen === true || search.searchOpen === 'true',
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (typeof window === 'undefined') {
      const { storefrontApi } = await import('@/server/api')
      return storefrontApi(deps)
    }
    const params = new URLSearchParams()
    Object.entries(deps).forEach(([key, value]) => {
      if (value !== undefined && value !== false && value !== '') params.set(key, String(value))
    })
    return getJson(`/api/storefront?${params}`)
  },
  component: Storefront,
})

function Storefront() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const model = search.model ?? 'all'
  const category = search.category ?? 'all'
  const sort = search.sort ?? 'featured'
  const term = search.search ?? ''
  const favoritesOnly = Boolean(search.favoritesOnly)
  const freeOnly = Boolean(search.freeOnly)
  return (
    <Chrome categories={data.categories} cartCount={data.cart.totals.count}>
      <TopFilters
        model={model}
        category={category}
        sort={sort}
        search={term}
        favoritesOnly={favoritesOnly}
        freeOnly={freeOnly}
        searchOpen={Boolean(search.searchOpen) || term.length > 0}
      />
      <section className="gallery" aria-label="Prompt marketplace">
        {data.prompts.length ? (
          <div className="masonry">
            {data.prompts.map((prompt) => <PromptCard key={prompt.id} prompt={prompt} />)}
          </div>
        ) : (
          <div className="empty">
            <strong>Nothing here yet</strong>
            <span>{favoritesOnly ? 'Tap the bookmark on any prompt to save it.' : 'Try a different filter or search.'}</span>
          </div>
        )}
      </section>
    </Chrome>
  )
}
