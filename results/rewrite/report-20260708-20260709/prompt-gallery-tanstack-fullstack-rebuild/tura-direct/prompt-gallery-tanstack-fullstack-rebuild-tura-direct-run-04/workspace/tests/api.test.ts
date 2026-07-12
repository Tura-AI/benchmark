import { beforeEach, describe, expect, it } from 'vitest'
import { addToCart, getAnalytics, listPrompts, resetForTests, toggleFavorite } from '../src/data/db'

describe('backend/API behavior contract', () => {
  beforeEach(() => resetForTests())
  it('filters catalog by model, search term, and popularity', () => {
    const flux = listPrompts({ model: 'Flux', sort: 'Popular' })
    expect(flux.every((p) => p.model === 'Flux')).toBe(true)
    expect(flux[0].sold).toBeGreaterThanOrEqual(flux[1].sold)
    expect(listPrompts({ term: 'memo' }).some((p) => p.slug === 'meeting-to-memo')).toBe(true)
  })
  it('mutates favorite and cart state through backend helpers', () => {
    expect(toggleFavorite(160).favorite).toBe(true)
    expect(listPrompts({ favoritesOnly: true }).some((p) => p.id === 160)).toBe(true)
    const cart = addToCart(301)
    expect(cart.items.some((p) => p.id === 301)).toBe(true)
    expect(cart.totalCents).toBeGreaterThan(cart.subtotalCents)
  })
  it('returns admin analytics shape used by the route/API', () => {
    const a: any = getAnalytics()
    expect(a.summary).toHaveProperty('revenueCents')
    expect(a.creatorRevenue[0]).toHaveProperty('creator')
    expect(a.categoryRevenue[0]).toHaveProperty('category')
    expect(a.daily[0]).toHaveProperty('conversionRate')
  })
})
