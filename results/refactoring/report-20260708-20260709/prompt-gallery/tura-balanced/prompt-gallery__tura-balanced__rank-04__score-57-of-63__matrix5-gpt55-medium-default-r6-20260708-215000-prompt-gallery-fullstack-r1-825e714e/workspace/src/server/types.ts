export type ModelName = 'GPT-4o' | 'Claude' | 'Midjourney' | 'Flux'
export type SortName = 'featured' | 'newest' | 'popular'

export type PromptCard = {
  id: number
  slug: string
  title: string
  model: ModelName
  category: string
  price: number
  sold: number
  rating: number
  creator: string
  aspectRatio: string
  description: string
  imageUrl: string
  isFavorite: boolean
  inCart: boolean
  rankScore: number
}

export type CatalogFilters = {
  model?: ModelName | 'all'
  category?: string | 'all'
  sort?: SortName
  term?: string
  favoritesOnly?: boolean
  priceMode?: 'all' | 'free' | 'paid'
}

export type CartTotals = {
  subtotal: number
  fees: number
  total: number
  itemCount: number
}

export type AnalyticsSummary = {
  creatorRevenue: Array<{ creator: string; revenue: number; sales: number; conversionRate: number; averageOrderValue: number }>
  categoryRevenue: Array<{ category: string; revenue: number; sales: number }>
  dailySales: Array<{ day: string; revenue: number; orders: number }>
  totals: { revenue: number; orders: number; conversionRate: number; averageOrderValue: number }
}
