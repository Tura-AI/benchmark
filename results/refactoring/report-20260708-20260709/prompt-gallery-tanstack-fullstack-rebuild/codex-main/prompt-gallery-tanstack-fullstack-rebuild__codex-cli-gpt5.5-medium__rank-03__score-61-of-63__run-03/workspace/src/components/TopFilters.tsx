import { Circle, Diamond, Grid2X2, Search, Triangle } from 'lucide-react'

const models = [
  { label: 'All', value: 'all', icon: Grid2X2 },
  { label: 'GPT-4o', value: 'GPT-4o', icon: Circle },
  { label: 'Claude', value: 'Claude', icon: Search },
  { label: 'Midjourney', value: 'Midjourney', icon: Triangle },
  { label: 'Flux', value: 'Flux', icon: Diamond },
]

export type GallerySearch = {
  model: string
  category: string
  sort: 'featured' | 'newest' | 'popular'
  q: string
  favorites: boolean
  freeOnly: boolean
  searchOpen: boolean
}

export function TopFilters({
  search,
  onChange,
}: {
  search: GallerySearch
  onChange: (patch: Partial<GallerySearch>) => void
}) {
  return (
    <div className="topbar">
      <div className="filterbar">
        <div className="ftabs" role="tablist" aria-label="Model filters">
          {models.map((model) => {
            const Icon = model.icon
            return (
              <button
                key={model.value}
                className={`ftab ${search.model === model.value ? 'active' : ''}`}
                onClick={() => onChange({ model: model.value, favorites: false })}
              >
                <Icon /> {model.label}
              </button>
            )
          })}
        </div>
        <div className="fsort" aria-label="Sort prompts">
          {(['featured', 'newest', 'popular'] as const).map((sort) => (
            <button key={sort} className={`sortbtn ${search.sort === sort ? 'active' : ''}`} onClick={() => onChange({ sort })}>
              {sort[0].toUpperCase() + sort.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className={`searchbar ${search.searchOpen ? 'open' : ''}`}>
        <div className="inner">
          <Search />
          <input
            type="search"
            value={search.q}
            onChange={(event) => onChange({ q: event.target.value, searchOpen: true })}
            placeholder="Search prompts - portrait, poster, cold email..."
            aria-label="Search prompts"
          />
        </div>
      </div>
    </div>
  )
}
