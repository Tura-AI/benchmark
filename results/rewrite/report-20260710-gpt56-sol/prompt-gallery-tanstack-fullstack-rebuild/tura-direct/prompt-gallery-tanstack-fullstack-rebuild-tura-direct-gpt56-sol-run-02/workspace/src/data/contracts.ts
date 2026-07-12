export const MODELS = ['All', 'GPT-4o', 'Claude', 'Midjourney', 'Flux'] as const
export const SORTS = ['featured', 'newest', 'popular'] as const
export type Sort = (typeof SORTS)[number]

export interface CatalogFilters {
  model?: string
  category?: string
  sort?: Sort
  q?: string
  favorites?: boolean
  price?: 'all' | 'free' | 'paid'
}

export interface PromptRecord {
  id: number
  title: string
  model: string
  category: string
  price: number
  sold: number
  rating: number
  creator: string
  creatorId: number
  aspectRatio: string
  description: string
  image: string
  featured: number
  createdAt: string
  rank: number
  isFavorite: number
  inCart: number
}

export interface CartSummary {
  items: Array<PromptRecord & { quantity: number }>
  subtotal: number
  fee: number
  total: number
}
