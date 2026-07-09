import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { addCartApi, cartStateApi, checkoutApi, creatorAnalyticsApi, promptDetailApi, removeCartApi, storefrontApi, toggleFavoriteApi } from './marketplace-api'

const catalogSchema = z.object({
  model: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(['featured', 'newest', 'popular']).optional(),
  q: z.string().optional(),
  favoritesOnly: z.boolean().optional(),
  freeOnly: z.boolean().optional(),
})

const promptSchema = z.object({ promptId: z.number().int().positive() })

export const getStorefront = createServerFn({ method: 'GET' })
  .validator((input: unknown) => catalogSchema.parse(input ?? {}))
  .handler(({ data }) => storefrontApi(data))

export const getPromptDetail = createServerFn({ method: 'GET' })
  .validator((input: unknown) => promptSchema.parse(input))
  .handler(({ data }) => promptDetailApi(data.promptId))

export const toggleFavoriteAction = createServerFn({ method: 'POST' })
  .validator((input: unknown) => promptSchema.parse(input))
  .handler(({ data }) => toggleFavoriteApi(data.promptId))

export const addCartAction = createServerFn({ method: 'POST' })
  .validator((input: unknown) => promptSchema.parse(input))
  .handler(({ data }) => addCartApi(data.promptId))

export const removeCartAction = createServerFn({ method: 'POST' })
  .validator((input: unknown) => promptSchema.parse(input))
  .handler(({ data }) => removeCartApi(data.promptId))

export const checkoutAction = createServerFn({ method: 'POST' }).handler(() => checkoutApi())

export const getCartState = createServerFn({ method: 'GET' }).handler(() => cartStateApi())

export const getCreatorAnalytics = createServerFn({ method: 'GET' }).handler(() => creatorAnalyticsApi())
