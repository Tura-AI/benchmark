import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import type { CatalogFilters } from '../lib/types'

const database = createServerOnlyFn(() => import('./db.server'))

const catalogInput = (data: CatalogFilters | undefined) => data || {}
const idInput = (data: { promptId: number }) => ({ promptId: Number(data.promptId) })
const slugInput = (data: { slug: string }) => ({ slug: String(data.slug) })

export const getCatalogData = createServerFn({ method: 'GET' })
  .inputValidator(catalogInput)
  .handler(async ({ data }) => { const m = await database(); return m.listCatalog(m.getDb(), data) })

export const getPromptData = createServerFn({ method: 'GET' })
  .inputValidator(slugInput)
  .handler(async ({ data }) => { const m = await database(); return m.getPromptBySlug(m.getDb(), data.slug) ?? null })

export const getCartData = createServerFn({ method: 'GET' })
  .handler(async () => { const m = await database(); return m.getCart(m.getDb()) })

export const getAnalyticsData = createServerFn({ method: 'GET' })
  .handler(async () => { const m = await database(); return m.getAnalytics(m.getDb()) })

export const favoritePrompt = createServerFn({ method: 'POST' })
  .inputValidator(idInput)
  .handler(async ({ data }) => { const m = await database(); return m.toggleFavorite(m.getDb(), data.promptId) })

export const cartPrompt = createServerFn({ method: 'POST' })
  .inputValidator(idInput)
  .handler(async ({ data }) => { const m = await database(); return m.addToCart(m.getDb(), data.promptId) })

export const uncartPrompt = createServerFn({ method: 'POST' })
  .inputValidator(idInput)
  .handler(async ({ data }) => { const m = await database(); return m.removeFromCart(m.getDb(), data.promptId) })

export const checkoutCart = createServerFn({ method: 'POST' })
  .handler(async () => { const m = await database(); return m.checkout(m.getDb()) })
