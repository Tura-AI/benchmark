export type ModelName = 'GPT-4o' | 'Claude' | 'Midjourney' | 'Flux'

export type Prompt = {
  id: number
  slug: string
  title: string
  model: ModelName
  category: string
  price: number
  sold: number
  views: number
  rating: number
  seller: string
  creatorId: number
  aspect: string
  description: string
  promptText: string
  imageUrl: string
  featured: number
  createdAt: string
  isFavorite: number
  rankScore: number
}

export type CatalogFilters = {
  model?: string
  category?: string
  sort?: 'featured' | 'newest' | 'popular'
  term?: string
  favorites?: boolean
  free?: boolean
}

export type CatalogData = {
  prompts: Prompt[]
  categories: Array<{ name: string; count: number }>
  counts: { all: number; featured: number; free: number; favorites: number }
  cartCount: number
}

export type CartData = {
  items: Array<Prompt & { quantity: number }>
  subtotal: number
  fee: number
  total: number
  count: number
}
