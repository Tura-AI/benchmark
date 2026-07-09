import { beforeEach, describe, expect, test } from 'vitest'
import { resetDatabase } from '../src/data/db'
import { analyticsApi, cartApi, catalogApi, checkoutApi, favoriteApi } from '../src/data/api'
import type { Analytics, CartSummary, StorefrontData } from '../src/data/types'

beforeEach(() => resetDatabase())

describe('server function boundary', () => {
  test('loads catalog through the server function wrapper', async () => {
    const response = await catalogApi(new Request('http://local/api/catalog?model=Claude&sort=popular'))
    const catalog = await response.json() as StorefrontData
    expect(catalog.prompts.every((prompt) => prompt.model === 'Claude')).toBe(true)
    expect(catalog.counts.cart).toBe(2)
  })

  test('mutates favorites and cart through server functions', async () => {
    const favoriteResponse = await favoriteApi(new Request('http://local/api/favorite', { method: 'POST', body: JSON.stringify({ promptId: 160 }) }))
    const favorite = await favoriteResponse.json()
    expect(favorite.favorited).toBe(true)
    const cartResponse = await cartApi(new Request('http://local/api/cart', { method: 'POST', body: JSON.stringify({ promptId: 160 }) }))
    const cart = await cartResponse.json() as CartSummary
    expect(cart.items.some((item) => item.id === 160)).toBe(true)
    const nextResponse = await cartApi(new Request('http://local/api/cart?promptId=160', { method: 'DELETE' }))
    const next = await nextResponse.json() as CartSummary
    expect(next.items.some((item) => item.id === 160)).toBe(false)
  })

  test('checkout and analytics cross the backend boundary', async () => {
    await cartApi(new Request('http://local/api/cart', { method: 'POST', body: JSON.stringify({ promptId: 207 }) }))
    const orderResponse = await checkoutApi()
    const order = await orderResponse.json()
    expect(order.total).toBe(22.68)
    const analyticsResponse = await analyticsApi()
    const analytics = await analyticsResponse.json() as Analytics
    expect(analytics.orderCount).toBe(6)
    expect(analytics.totalRevenue).toBeGreaterThan(196)
  })
})
