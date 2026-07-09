import { beforeEach, describe, expect, it } from 'vitest'
import { resetDbForTests } from '../src/data/db'
import { api } from '../src/market-api'

describe('server function marketplace behavior', () => {
  beforeEach(async () => {
    await resetDbForTests()
  })

  it('serves filtered catalog and prompt detail', async () => {
    const flux = await api.catalog({ model: 'Flux', sort: 'popular' })
    expect(flux.length).toBeGreaterThan(2)
    expect(flux.every((prompt: any) => prompt.model === 'Flux')).toBe(true)

    const prompt = await api.prompt(301)
    expect(prompt).toMatchObject({ title: 'Magazine Cover Maker', model: 'GPT-4o' })
  })

  it('mutates favorites, cart, and checkout through server functions', async () => {
    const fav = await api.toggleFavorite(198)
    expect(fav.favorite).toBe(true)

    const cart = await api.addToCart(198)
    expect(cart.items.map((item: any) => item.id)).toContain(198)

    const current = await api.cart()
    expect(current.totals.total).toBeGreaterThan(0)

    const order = await api.checkout()
    expect(order.ok).toBe(true)
    const analytics = await api.analytics()
    expect(analytics.summary.revenue).toBeGreaterThan(0)
  })
})
