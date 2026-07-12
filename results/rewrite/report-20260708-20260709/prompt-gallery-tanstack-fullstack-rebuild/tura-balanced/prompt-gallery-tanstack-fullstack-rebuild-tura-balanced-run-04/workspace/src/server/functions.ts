import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { addToCart, checkout, getAnalytics, getCart, getFilterCounts, getPrompt, listCategories, listPrompts, removeFromCart, toggleFavorite } from './queries'

const catalogSchema = z.object({
  model: z.enum(['all', 'GPT-4o', 'Claude', 'Midjourney', 'Flux']).optional(),
  category: z.string().optional(),
  sort: z.enum(['featured', 'newest', 'popular']).optional(),
  term: z.string().optional(),
  favoritesOnly: z.boolean().optional(),
  priceMode: z.enum(['all', 'free', 'paid']).optional(),
})

const idSchema = z.object({ promptId: z.number().int().positive() })

export const getCatalogFn = createServerFn({ method: 'GET' })
  .validator((data: unknown) => catalogSchema.parse(data ?? {}))
  .handler(({ data }) => ({ prompts: listPrompts(data), categories: listCategories(), counts: getFilterCounts(), cart: getCart() }))

export const getPromptFn = createServerFn({ method: 'GET' })
  .validator((data: unknown) => z.object({ slug: z.string() }).parse(data))
  .handler(({ data }) => getPrompt(data.slug))

export const toggleFavoriteFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => idSchema.parse(data))
  .handler(({ data }) => ({ isFavorite: toggleFavorite(data.promptId) }))

export const addToCartFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => idSchema.parse(data))
  .handler(({ data }) => addToCart(data.promptId))

export const removeFromCartFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => idSchema.parse(data))
  .handler(({ data }) => removeFromCart(data.promptId))

export const getCartFn = createServerFn({ method: 'GET' }).handler(() => getCart())

export const checkoutFn = createServerFn({ method: 'POST' }).handler(() => checkout())

export const getAnalyticsFn = createServerFn({ method: 'GET' }).handler(() => getAnalytics())
