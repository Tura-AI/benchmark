import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../src/db/database'
import { marketApi } from '../src/server/market-api'

describe('server functions', () => {
  beforeEach(async () => {
    await getDb({ reset: true })
  })

  it('loads a filtered marketplace through the backend boundary', async () => {
    const data = await marketApi.marketplace({
      model: 'GPT-4o',
      sort: 'popular',
      query: 'cover',
    })
    expect(data.prompts).toHaveLength(1)
    expect(data.prompts[0].title).toBe('Magazine Cover Maker')
    expect(data.filters.counts.paid).toBeGreaterThan(10)
  })

  it('loads detail and mutates favorites/cart through server functions', async () => {
    const prompt = await marketApi.promptDetail(207)
    expect(prompt?.title).toBe('Cinematic Still, 35mm')

    const favorite = await marketApi.toggleFavorite(207)
    expect(favorite.isFavorite).toBe(false)

    const cart = await marketApi.addToCart(207)
    expect(cart.items.some((item) => item.id === 207)).toBe(true)
  })

  it('checks out and refreshes analytics', async () => {
    const before = await marketApi.cart()
    expect(before.items.length).toBeGreaterThan(0)
    const result = await marketApi.checkout()
    expect(result.ok).toBe(true)
    expect(result.cart.items).toHaveLength(0)
    const analytics = await marketApi.analytics()
    expect(analytics.summary.orders).toBe(7)
  })
})
