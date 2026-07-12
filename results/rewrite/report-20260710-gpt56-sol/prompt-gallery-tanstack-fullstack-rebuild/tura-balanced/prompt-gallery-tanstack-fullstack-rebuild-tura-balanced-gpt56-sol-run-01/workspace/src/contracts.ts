import { z } from 'zod'

export const models = ['all', 'GPT-4o', 'Claude', 'Midjourney', 'Flux'] as const
export const sorts = ['featured', 'newest', 'popular'] as const

export const catalogInput = z.object({
  model: z.enum(models).default('all'),
  category: z.string().max(40).default('all'),
  sort: z.enum(sorts).default('featured'),
  query: z.string().trim().max(80).default(''),
  favoritesOnly: z.boolean().default(false),
  price: z.enum(['all', 'free', 'paid']).default('all'),
})

export const promptIdInput = z.object({ promptId: z.coerce.number().int().positive() })
export const cartInput = promptIdInput.extend({ quantity: z.coerce.number().int().min(1).max(10).default(1) })
export const checkoutInput = z.object({ email: z.string().email().max(160) })

export type CatalogInput = z.infer<typeof catalogInput>

export type Prompt = {
  id: number
  title: string
  model: string
  category: string
  price: number
  sold: number
  rating: number
  creatorId: number
  creator: string
  aspectRatio: string
  description: string
  image: string
  featured: boolean
  createdAt: string
  isFavorite: boolean
  rankScore: number
}

export type CartSummary = {
  items: Array<Prompt & { quantity: number; lineTotal: number }>
  itemCount: number
  subtotal: number
  serviceFee: number
  total: number
}
