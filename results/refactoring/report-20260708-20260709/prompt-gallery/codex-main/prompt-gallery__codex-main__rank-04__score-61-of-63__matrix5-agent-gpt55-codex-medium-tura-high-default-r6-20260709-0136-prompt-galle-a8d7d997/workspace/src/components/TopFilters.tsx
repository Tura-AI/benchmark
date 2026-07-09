import { Circle, Diamond, Grid2X2, Search, Triangle } from 'lucide-react'

const models = [
  ['all', 'All', Grid2X2],
  ['GPT-4o', 'GPT-4o', Circle],
  ['Claude', 'Claude', Search],
  ['Midjourney', 'Midjourney', Triangle],
  ['Flux', 'Flux', Diamond],
] as const

const sorts = [
  ['featured', 'Featured'],
  ['newest', 'Newest'],
  ['popular', 'Popular'],
] as const

export function TopFilters({
  model,
  sort,
  search,
  category,
  favoritesOnly,
  freeOnly,
  searchOpen,
}: {
  model: string
  sort: string
  search: string
  category: string
  favoritesOnly: boolean
  freeOnly: boolean
  searchOpen: boolean
}) {
  const href = (next: Record<string, string | boolean>) => {
    const params = new URLSearchParams()
    const values = { model, category, sort, search, favoritesOnly, freeOnly, searchOpen, ...next }
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== false && value !== '' && value !== 'all') params.set(key, String(value))
    })
    const query = params.toString()
    return query ? `/?${query}` : '/'
  }
  return (
    <div className="topbar">
      <div className="filterbar">
        <div className="ftabs">
          {models.map(([value, label, Icon]) => (
            <a key={value} className={`ftab ${model === value ? 'active' : ''}`} href={href({ model: value })}>
              <Icon />{label}
            </a>
          ))}
        </div>
        <div className="fsort">
          {sorts.map(([value, label]) => (
            <a key={value} className={`sortbtn ${sort === value ? 'active' : ''}`} href={href({ sort: value })}>
              {label}
            </a>
          ))}
        </div>
      </div>
      <form className={`searchbar ${searchOpen ? 'open' : ''}`} action="/" method="get">
        <div className="search-inner">
          <Search />
          <input type="hidden" name="model" value={model} />
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="searchOpen" value="true" />
          <input name="search" defaultValue={search} placeholder="Search prompts - portrait, poster, cold email..." aria-label="Search prompts" />
        </div>
      </form>
    </div>
  )
}
