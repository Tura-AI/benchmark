export type SortKey = 'featured' | 'newest' | 'popular'

export type Prompt = {
  id: number
  slug: string
  title: string
  model: string
  category: string
  categorySlug: string
  price: number
  sold: number
  rating: number
  creator: string
  creatorHandle: string
  aspectRatio: string
  description: string
  image: string
  featured: number
  favorite: number
  rankScore: number
}

export type CatalogResult = {
  prompts: Prompt[]
  categories: Array<{ name: string; slug: string; count: number }>
  counts: { all: number; free: number; paid: number; favorites: number }
  cartCount: number
}

export type CartResult = {
  items: Array<Prompt & { quantity: number }>
  subtotal: number
  fee: number
  total: number
  count: number
}

export type AnalyticsResult = {
  summary: { revenue: number; creatorRevenue: number; orders: number; conversionRate: number; averageOrderValue: number; averagePromptPrice: number }
  daily: Array<{ day: string; sales: number; orders: number }>
  categories: Array<{ name: string; revenue: number; units: number }>
  creators: Array<{ name: string; handle: string; revenue: number; sales: number; prompts: number }>
  topPrompts: Array<{ title: string; image: string; model: string; revenue: number; units: number }>
}
