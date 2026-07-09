import { beforeEach, describe, expect, it } from 'vitest'
import { resetDbForTests } from '../src/server/db'
import { addCartApi, analyticsApi, cartApi, checkoutApi, favoriteApi, promptDetailApi, storefrontApi } from '../src/server/api'

beforeEach(() => {
  resetDbForTests()
})

describe('server function flows', () => {
  it('serves storefront filters and prompt detail', async () => {
    const storefront = storefrontApi({ model: 'Flux', sort: 'popular' })
    expect(storefront.prompts.length).toBeGreaterThan(2)
    expect(storefront.prompts.every((p) => p.model === 'Flux')).toBe(true)
    expect(storefront.categories.map((c) => c.name)).toContain('Marketing')
    const detail = promptDetailApi(storefront.prompts[0].id)
    expect(detail.prompt?.id).toBe(storefront.prompts[0].id)
  })

  it('mutates favorites and cart through backend functions', async () => {
    const fav = favoriteApi(207)
    expect(fav.favorited).toBe(true)
    addCartApi(301)
    const cart = cartApi()
    expect(cart.totals.subtotal).toBe(35)
    expect(cart.items.some((item) => item.id === 301)).toBe(true)
  })

  it('checks out cart and refreshes analytics', async () => {
    addCartApi(301)
    const result = checkoutApi()
    expect(result.ok).toBe(true)
    expect(result.orderId).toBeTruthy()
    expect(result.cart.items).toHaveLength(0)
    const analytics = analyticsApi()
    expect(analytics.summary.orders).toBeGreaterThan(12)
  })
})
