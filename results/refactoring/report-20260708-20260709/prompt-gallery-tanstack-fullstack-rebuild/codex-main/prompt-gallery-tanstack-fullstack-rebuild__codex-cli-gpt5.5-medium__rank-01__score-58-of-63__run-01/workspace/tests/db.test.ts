import { beforeEach, describe, expect, it } from 'vitest'
import {
  addToCart,
  checkout,
  getAnalytics,
  getCart,
  getDb,
  getFilters,
  listPrompts,
  toggleFavorite,
} from '../src/db/database'

describe('database calculations', () => {
  beforeEach(async () => {
    await getDb({ reset: true })
  })

  it('ranks featured prompts in SQL and exposes source vocabulary', async () => {
    const prompts = await listPrompts({ sort: 'featured' })
    expect(prompts.length).toBeGreaterThanOrEqual(12)
    expect(prompts[0].title).toBe('The Socratic Tutor')
    expect(new Set(prompts.map((prompt) => prompt.model))).toEqual(
      new Set(['GPT-4o', 'Claude', 'Midjourney', 'Flux']),
    )
    expect(prompts[0].rankScore).toBeGreaterThan(prompts[5].rankScore)
  })

  it('computes filter counts and cart totals from SQLite', async () => {
    const filters = await getFilters()
    expect(filters.counts.featured).toBeGreaterThan(6)
    expect(filters.counts.free).toBe(1)
    expect(filters.counts.cart).toBe(2)

    const cart = await getCart()
    expect(cart.totals.subtotal).toBe(26)
    expect(cart.totals.platformFee).toBe(1.69)
    expect(cart.totals.total).toBe(27.69)
  })

  it('computes creator, category, conversion, AOV, and trend summaries', async () => {
    const analytics = await getAnalytics()
    expect(analytics.summary.grossRevenue).toBe(226)
    expect(analytics.summary.creatorRevenue).toBe(192.1)
    expect(analytics.summary.conversionRate).toBeCloseTo(0.41, 2)
    expect(analytics.summary.averageOrderValue).toBe(37.92)
    expect(analytics.categoryRevenue[0].revenue).toBeGreaterThan(40)
    expect(analytics.dailySales).toHaveLength(6)
  })

  it('persists favorite/cart mutations and checkout clears the cart', async () => {
    const favorite = await toggleFavorite(118)
    expect(favorite.isFavorite).toBe(true)
    await addToCart(118)
    expect((await getCart()).items.some((item) => item.id === 118)).toBe(true)
    const result = await checkout()
    expect(result.ok).toBe(true)
    expect(result.cart.items).toHaveLength(0)
  })
})
