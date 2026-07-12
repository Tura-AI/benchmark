import { z } from 'zod'

export const catalogInput = z.object({
  model: z.enum(['all', 'GPT-4o', 'Claude', 'Midjourney', 'Flux']).default('all'),
  category: z.string().default('all'),
  sort: z.enum(['featured', 'newest', 'popular']).default('featured'),
  search: z.string().max(80).default(''),
  favorites: z.boolean().default(false),
  free: z.boolean().default(false),
})

export const idInput = z.object({ promptId: z.number().int().positive() })
export const quantityInput = idInput.extend({ quantity: z.number().int().min(0).max(9) })

export type CatalogInput = z.infer<typeof catalogInput>

export type Prompt = {
  id: number
  slug: string
  title: string
  model: string
  category: string
  price: number
  sold: number
  views: number
  rating: number
  creatorId: number
  creator: string
  aspect: string
  description: string
  image: string
  featured: number
  createdAt: string
  rank: number
  favorite: number
}

export type CatalogResult = {
  prompts: Prompt[]
  counts: { total: number; free: number; paid: number; featured: number; favorites: number }
  categories: Array<{ name: string; count: number }>
}

export type CartSummary = {
  items: Array<Prompt & { quantity: number; lineTotal: number }>
  itemCount: number
  subtotal: number
  fee: number
  total: number
}

export type Analytics = {
  creator: { name: string; revenue: number; orders: number; views: number; conversionRate: number; averageOrderValue: number }
  categories: Array<{ category: string; revenue: number; units: number }>
  daily: Array<{ day: string; orders: number; revenue: number }>
}
