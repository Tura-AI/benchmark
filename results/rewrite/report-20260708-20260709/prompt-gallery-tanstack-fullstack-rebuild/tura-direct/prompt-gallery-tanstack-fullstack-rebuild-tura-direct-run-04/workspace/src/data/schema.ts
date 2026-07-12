export type ModelName = 'GPT-4o' | 'Claude' | 'Midjourney' | 'Flux'
export type SortName = 'Featured' | 'Newest' | 'Popular'

export type CatalogFilters = {
  model?: ModelName | 'All'
  category?: string
  sort?: SortName
  term?: string
  favoritesOnly?: boolean
  userId?: number
  price?: 'all' | 'free' | 'paid'
}

export type PromptCard = {
  id: number
  title: string
  slug: string
  model: ModelName
  category: string
  creator: string
  priceCents: number
  sold: number
  rating: number
  aspectRatio: string
  image: string
  description: string
  featured: boolean
  isFavorite: boolean
  inCart: boolean
  rankScore: number
  createdAt: string
}

export type CartSummary = {
  items: PromptCard[]
  subtotalCents: number
  feesCents: number
  totalCents: number
  freeCount: number
  paidCount: number
}
