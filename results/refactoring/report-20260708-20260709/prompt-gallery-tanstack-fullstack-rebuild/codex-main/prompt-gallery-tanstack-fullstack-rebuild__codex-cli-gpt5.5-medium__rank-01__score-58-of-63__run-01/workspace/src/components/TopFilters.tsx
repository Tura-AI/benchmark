import { Icons } from './icons'

const models = ['All', 'GPT-4o', 'Claude', 'Midjourney', 'Flux']
const sorts = ['Featured', 'Newest', 'Popular'] as const

export function TopFilters({
  model,
  sort,
  query,
  searchOpen,
  onModel,
  onSort,
  onQuery,
}: {
  model: string
  sort: string
  query: string
  searchOpen: boolean
  onModel: (model: string) => void
  onSort: (sort: 'featured' | 'newest' | 'popular') => void
  onQuery: (query: string) => void
}) {
  return (
    <div className="topbar">
      <div className="filterbar">
        <div className="ftabs" aria-label="Model filters">
          {models.map((item) => (
            <button
              className={`ftab ${model === item ? 'active' : ''}`}
              key={item}
              onClick={() => onModel(item)}
            >
              {item === 'All' ? <Icons.Grid2X2 /> : <Icons.Sparkles />}
              {item}
            </button>
          ))}
        </div>
        <div className="fsort" aria-label="Sort controls">
          {sorts.map((item) => (
            <button
              key={item}
              className={`sortbtn ${sort === item.toLowerCase() ? 'active' : ''}`}
              onClick={() => onSort(item.toLowerCase() as 'featured' | 'newest' | 'popular')}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className={`searchbar ${searchOpen ? 'open' : ''}`}>
        <div className="inner">
          <Icons.Search />
          <input
            aria-label="Search prompts"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder='Search prompts: "portrait", "poster", "cold email"...'
          />
        </div>
      </div>
    </div>
  )
}
