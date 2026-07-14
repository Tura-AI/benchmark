import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleCartRequest, handleCatalogRequest, handleCheckoutRequest, handleFavoriteRequest } from '../src/data/api.server'
import { MarketplaceDb } from '../src/data/db.server'

describe('public marketplace API boundary', () => {
  let market: MarketplaceDb
  beforeEach(() => { market = new MarketplaceDb(':memory:') })
  afterEach(() => market.close())

  it('returns searchable, sorted catalog JSON', async () => {
    const response = handleCatalogRequest(new Request('http://local/api/catalog?model=Flux&q=portrait&sort=popular'), market)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.prompts.map((p: { title: string }) => p.title)).toEqual(['Studio Portrait, Soft Light', 'Dreamy Bokeh Portrait'])
  })

  it('validates catalog parameters', async () => {
    const response = handleCatalogRequest(new Request('http://local/api/catalog?sort=cheapest'), market)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid sort value' })
  })

  it('adds, updates, and removes cart rows through request handlers', async () => {
    const added = await handleCartRequest(new Request('http://local/api/cart', { method: 'POST', body: JSON.stringify({ promptId: 207 }) }), market)
    expect((await added.json()).count).toBe(2)
    const patched = await handleCartRequest(new Request('http://local/api/cart', { method: 'PATCH', body: JSON.stringify({ promptId: 207, quantity: 2 }) }), market)
    expect(await patched.json()).toMatchObject({ subtotal: 32, total: 33.6, count: 3 })
    const removed = await handleCartRequest(new Request('http://local/api/cart', { method: 'PATCH', body: JSON.stringify({ promptId: 207, quantity: 0 }) }), market)
    expect((await removed.json()).count).toBe(1)
  })

  it('persists favorite mutations and completes checkout atomically', async () => {
    const favorite = await handleFavoriteRequest(new Request('http://local/api/favorites', { method: 'POST', body: JSON.stringify({ promptId: 233 }) }), market)
    expect(await favorite.json()).toEqual({ favorite: true, count: 3 })
    const checkout = handleCheckoutRequest(market)
    expect(checkout.status).toBe(201)
    expect(await checkout.json()).toMatchObject({ reference: 'PP-1049', total: 14.7, items: 1 })
    expect(market.getCart().count).toBe(0)
    expect(handleCheckoutRequest(market).status).toBe(409)
  })
})
