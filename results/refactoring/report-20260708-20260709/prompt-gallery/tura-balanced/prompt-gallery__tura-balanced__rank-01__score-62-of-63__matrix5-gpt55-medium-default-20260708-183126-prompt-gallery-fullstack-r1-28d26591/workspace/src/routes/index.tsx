import { createFileRoute } from '@tanstack/react-router'

import { AppShell } from '../components/AppShell'
import { Storefront } from '../components/Gallery'
import { getCartFn, getCatalogFn, getPromptFn, type CatalogFilters } from '../server/queries'

type StoreSearch = CatalogFilters & { favorites?: string; free?: string; preview?: string }

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): StoreSearch => ({
    model: search.model != null ? String(search.model) as StoreSearch['model'] : 'all',
    category: search.category != null ? String(search.category) : 'all',
    sort: search.sort != null ? String(search.sort) as StoreSearch['sort'] : 'featured',
    q: search.q != null ? String(search.q) : '',
    favorites: search.favorites === '1' ? '1' : undefined,
    free: search.free === '1' ? '1' : undefined,
    preview: search.preview != null ? String(search.preview) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [catalog, cart] = await Promise.all([
      getCatalogFn({ data: { ...deps, favoritesOnly: deps.favorites === '1', freeOnly: deps.free === '1' } }),
      getCartFn(),
    ])
    const previewId = deps.preview ? Number(String(deps.preview).replace(/^"|"$/g, '')) : 0
    const previewPrompt = Number.isFinite(previewId) && previewId > 0 ? await getPromptFn({ data: previewId }) : null
    return { catalog, cart, previewPrompt }
  },
  component: IndexRoute,
})

function IndexRoute() {
  const { catalog, cart, previewPrompt } = Route.useLoaderData()
  return <AppShell cartCount={cart.totals.itemCount}><Storefront {...catalog} previewPrompt={previewPrompt} /></AppShell>
}
