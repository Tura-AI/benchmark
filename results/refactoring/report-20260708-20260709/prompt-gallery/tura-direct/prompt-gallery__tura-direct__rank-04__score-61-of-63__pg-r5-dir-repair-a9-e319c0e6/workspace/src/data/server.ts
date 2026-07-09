import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { addToCart, checkout, getAnalytics, getCartSummary, getCounts, getPrompt, listPrompts, removeFromCart, toggleFavorite } from './db'

const filterSchema = z.object({ model: z.string().optional(), category: z.string().optional(), sort: z.string().optional(), term: z.string().optional(), favoritesOnly: z.boolean().optional(), price: z.enum(['all','free','paid']).optional() })

export const fetchCatalog = createServerFn({ method: 'GET' }).validator((data) => filterSchema.parse(data ?? {})).handler(({ data }) => ({ prompts: listPrompts(data as any), counts: getCounts(1) }))
export const fetchPrompt = createServerFn({ method: 'GET' }).validator((data: unknown) => z.object({ slug: z.string() }).parse(data)).handler(({ data }) => getPrompt(data.slug, 1))
export const fetchCart = createServerFn({ method: 'GET' }).handler(() => getCartSummary(1))
export const fetchAnalytics = createServerFn({ method: 'GET' }).handler(() => getAnalytics())
export const favoritePrompt = createServerFn({ method: 'POST' }).validator((data: unknown) => z.object({ promptId: z.number() }).parse(data)).handler(({ data }) => ({ result: toggleFavorite(data.promptId, 1), counts: getCounts(1) }))
export const cartAdd = createServerFn({ method: 'POST' }).validator((data: unknown) => z.object({ promptId: z.number() }).parse(data)).handler(({ data }) => addToCart(data.promptId, 1))
export const cartRemove = createServerFn({ method: 'POST' }).validator((data: unknown) => z.object({ promptId: z.number() }).parse(data)).handler(({ data }) => removeFromCart(data.promptId, 1))
export const checkoutCart = createServerFn({ method: 'POST' }).handler(() => checkout(1))
