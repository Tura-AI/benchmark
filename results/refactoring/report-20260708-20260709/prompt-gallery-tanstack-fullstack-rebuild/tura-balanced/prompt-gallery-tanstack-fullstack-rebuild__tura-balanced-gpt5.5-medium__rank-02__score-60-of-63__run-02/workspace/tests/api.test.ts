import { describe, expect, it } from 'vitest'
import { addCartApi, creatorAnalyticsApi, storefrontApi, toggleFavoriteApi } from '../src/server/marketplace-api'

describe('server functions', () => {
  it('loads filtered storefront data through backend boundary', async () => {
    const data = storefrontApi({ model: 'Claude', sort: 'popular' })
    expect(data.prompts.every((prompt) => prompt.model === 'Claude')).toBe(true)
    expect(data.counts.models.some((model) => model.model === 'GPT-4o')).toBe(true)
  })

  it('mutates favorite and cart state through server functions', async () => {
    const favorite = toggleFavoriteApi(160)
    expect(typeof favorite.favorite.isFavorite).toBe('boolean')
    const cart = addCartApi(160)
    expect(cart.cart.count).toBeGreaterThan(0)
  })

  it('returns analytics calculated by database helpers', async () => {
    const analytics = creatorAnalyticsApi()
    expect(analytics.summary.averagePriceCents).toBeGreaterThan(0)
    expect(analytics.categoryRevenue.length).toBeGreaterThanOrEqual(8)
  })
})
