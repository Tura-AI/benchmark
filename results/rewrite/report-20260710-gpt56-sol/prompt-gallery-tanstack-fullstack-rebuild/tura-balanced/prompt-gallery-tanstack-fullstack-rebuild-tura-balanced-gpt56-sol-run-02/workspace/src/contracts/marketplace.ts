import { z } from 'zod'

export const models = ['all', 'GPT-4o', 'Claude', 'Midjourney', 'Flux'] as const
export const sorts = ['featured', 'newest', 'popular'] as const

export const catalogInputSchema = z.object({
  model: z.enum(models).default('all'),
  category: z.string().default('all'),
  sort: z.enum(sorts).default('featured'),
  q: z.string().max(80).default(''),
  favorites: z.boolean().default(false),
  free: z.boolean().default(false),
})

export const promptIdSchema = z.object({ promptId: z.string().min(1).max(80) })
export type CatalogInput = z.infer<typeof catalogInputSchema>

export interface Prompt {
  id: string
  title: string
  model: string
  category: string
  description: string
  priceCents: number
  sold: number
  rating: number
  creatorId: string
  creatorName: string
  image: string
  aspect: string
  createdAt: string
  featured: boolean
  favorite: boolean
  rankScore: number
}

export interface CartSummary {
  items: Array<Prompt & { quantity: number; lineTotalCents: number }>
  itemCount: number
  subtotalCents: number
  feeCents: number
  totalCents: number
}
