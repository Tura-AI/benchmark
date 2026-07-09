import { describe, expect, it } from 'vitest'
import { createConnection } from '../server/db'
import { addToCart, getAnalytics, getCart, listPrompts, toggleFavorite } from '../server/queries'

describe('backend behavior contracts', () => {
  it('filters catalog like the API/server function boundary', () => {
    const db = createConnection(`data/test-${crypto.randomUUID()}.json`)
    const flux = listPrompts({ model: 'Flux', sort: 'popular', term: 'portrait' }, db)
    expect(flux.length).toBeGreaterThan(0)
    expect(flux.every((item) => item.model === 'Flux')).toBe(true)
    expect(flux[0].rating).toBeGreaterThanOrEqual(flux.at(-1)?.rating ?? 0)
  })

  it('persists favorite and cart mutations', () => {
    const db = createConnection(`data/test-${crypto.randomUUID()}.json`)
    const saved = toggleFavorite(160, db)
    expect(saved).toBe(true)
    expect(listPrompts({ favoritesOnly: true }, db).some((prompt) => prompt.id === 160)).toBe(true)
    addToCart(160, db)
    expect(getCart(db).items.some((prompt) => prompt.id === 160)).toBe(true)
  })

  it('exposes analytics values expected by admin routes', () => {
    const analytics = getAnalytics(createConnection(`data/test-${crypto.randomUUID()}.json`))
    expect(analytics.totals.orders).toBeGreaterThan(0)
    expect(analytics.creatorRevenue[0]).toHaveProperty('conversionRate')
    expect(analytics.categoryRevenue[0]).toHaveProperty('revenue')
  })
})
