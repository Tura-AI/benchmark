import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Gallery } from '../components/Gallery'
import { type GallerySearch, TopFilters } from '../components/TopFilters'
import { api } from '../market-api'

const normalizeSearch = (raw: Record<string, unknown>): GallerySearch => ({
  model: typeof raw.model === 'string' ? raw.model : 'all',
  category: typeof raw.category === 'string' ? raw.category : 'all',
  sort: raw.sort === 'newest' || raw.sort === 'popular' ? raw.sort : 'featured',
  q: typeof raw.q === 'string' ? raw.q : '',
  favorites: raw.favorites === true || raw.favorites === 'true',
  freeOnly: raw.freeOnly === true || raw.freeOnly === 'true',
  searchOpen: raw.searchOpen === true || raw.searchOpen === 'true' || Boolean(raw.q),
})

export const Route = createFileRoute('/')({
  validateSearch: normalizeSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    api.catalog({
      model: deps.model,
      category: deps.category,
      sort: deps.sort,
      search: deps.q,
      favoritesOnly: deps.favorites,
      freeOnly: deps.freeOnly,
    }),
  component: Storefront,
})

function Storefront() {
  const prompts = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/' })

  const onChange = (patch: Partial<GallerySearch>) => {
    navigate({ search: (prev) => ({ ...prev, ...patch }) })
  }

  return (
    <>
      <TopFilters search={search} onChange={onChange} />
      <div className="gallery">
        {(search.category !== 'all' || search.favorites || search.freeOnly) && (
          <div className="context-row">
            <span>{search.favorites ? 'Favorites' : search.freeOnly ? 'Free prompts' : search.category}</span>
            <button onClick={() => onChange({ category: 'all', favorites: false, freeOnly: false })}>Clear</button>
          </div>
        )}
        <Gallery prompts={prompts as any} />
      </div>
    </>
  )
}
