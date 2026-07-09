import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  addToCart,
  checkout,
  getAnalytics,
  getCartSummary,
  getPrompt,
  getStorefront,
  removeFromCart,
  toggleFavorite,
} from './db'

const catalogQuery = z.object({
  model: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(['featured', 'newest', 'popular']).optional(),
  q: z.string().optional(),
  favorites: z.boolean().optional(),
  free: z.boolean().optional(),
})

const promptMutation = z.object({ promptId: z.number().int().positive() })

export const loadStorefront = createServerFn({ method: 'GET' })
  .validator((data: unknown) => catalogQuery.parse(data ?? {}))
  .handler(({ data }) => getStorefront(data))

export const loadPrompt = createServerFn({ method: 'GET' })
  .validator((data: unknown) => z.object({ id: z.number().int().positive() }).parse(data))
  .handler(({ data }) => getPrompt(data.id))

export const loadCart = createServerFn({ method: 'GET' }).handler(() => getCartSummary())

export const loadAnalytics = createServerFn({ method: 'GET' }).handler(() => getAnalytics())

export const saveFavorite = createServerFn({ method: 'POST' })
  .validator((data: unknown) => promptMutation.parse(data))
  .handler(({ data }) => toggleFavorite(data.promptId))

export const addPromptToCart = createServerFn({ method: 'POST' })
  .validator((data: unknown) => promptMutation.parse(data))
  .handler(({ data }) => addToCart(data.promptId))

export const removePromptFromCart = createServerFn({ method: 'POST' })
  .validator((data: unknown) => promptMutation.parse(data))
  .handler(({ data }) => removeFromCart(data.promptId))

export const checkoutCart = createServerFn({ method: 'POST' }).handler(() => checkout())
