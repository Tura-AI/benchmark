import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { addToCart, analytics, cartSummary, checkout, getCategories, getCounts, getPrompt, listPrompts, toggleFavorite } from './db'

const filters = z.object({ model: z.string().optional(), category: z.string().optional(), q: z.string().optional(), favorites: z.boolean().optional(), free: z.boolean().optional(), sort: z.enum(['featured','newest','popular']).optional() })
export const fetchCatalog = createServerFn({ method: 'GET' }).validator((d) => filters.parse(d ?? {})).handler(({ data }) => ({ prompts: listPrompts(data), categories: getCategories(), counts: getCounts() }))
export const fetchPrompt = createServerFn({ method: 'GET' }).validator((d) => z.object({ id: z.string() }).parse(d)).handler(({ data }) => getPrompt(data.id))
export const favoritePrompt = createServerFn({ method: 'POST' }).validator((d) => z.object({ id: z.string() }).parse(d)).handler(({ data }) => toggleFavorite(data.id))
export const putCart = createServerFn({ method: 'POST' }).validator((d) => z.object({ id: z.string() }).parse(d)).handler(({ data }) => addToCart(data.id))
export const fetchCart = createServerFn({ method: 'GET' }).handler(() => cartSummary())
export const runCheckout = createServerFn({ method: 'POST' }).handler(() => checkout())
export const fetchAnalytics = createServerFn({ method: 'GET' }).handler(() => analytics())
