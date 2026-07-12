import { beforeEach, describe, expect, it } from 'vitest'
import { addToCart, checkout, getAnalytics, getCart, getCatalog, getShellData, resetDbForTests, toggleFavorite } from '../src/data/db'

describe('POWERPROMPT database calculations', () => {
  beforeEach(async () => {
    await resetDbForTests()
  })

  it('ranks featured prompts and exposes source filters', async () => {
    const shell = await getShellData()
    expect(shell.counts.total).toBeGreaterThanOrEqual(12)
    expect(shell.counts.free).toBeGreaterThan(0)
    expect(shell.models.map((model) => model.model)).toEqual(expect.arrayContaining(['GPT-4o', 'Claude', 'Midjourney', 'Flux']))

    const catalog = await getCatalog({ sort: 'featured' })
    expect(catalog[0]).toMatchObject({ title: 'The Socratic Tutor' })
    expect(catalog.every((prompt: any) => typeof prompt.rankScore === 'number')).toBe(true)
  })

  it('calculates free, favorite, and cart totals in SQL query helpers', async () => {
    const free = await getCatalog({ freeOnly: true })
    expect(free).toHaveLength(1)
    expect(free[0]).toMatchObject({ price: 0 })

    const favorite = await toggleFavorite(160)
    expect(favorite.favorite).toBe(true)
    const favorites = await getCatalog({ favoritesOnly: true })
    expect(favorites.map((prompt: any) => prompt.id)).toContain(160)

    await addToCart(160)
    const cart = await getCart()
    expect(cart.totals.itemCount).toBeGreaterThanOrEqual(4)
    expect(cart.totals.total).toBe(cart.totals.subtotal + cart.totals.platformFee)
  })

  it('records checkout orders and updates analytics', async () => {
    await addToCart(211)
    const before = await getAnalytics()
    const result = await checkout()
    const after = await getAnalytics()
    expect(result.ok).toBe(true)
    expect(after.summary.orders).toBe(before.summary.orders + 1)
    expect(after.summary.averageOrderValue).toBeGreaterThan(0)
    expect(after.creators[0]).toHaveProperty('creatorRevenue')
    expect(after.categories.length).toBeGreaterThanOrEqual(4)
    expect(after.daily.length).toBeGreaterThan(0)
  })
})
