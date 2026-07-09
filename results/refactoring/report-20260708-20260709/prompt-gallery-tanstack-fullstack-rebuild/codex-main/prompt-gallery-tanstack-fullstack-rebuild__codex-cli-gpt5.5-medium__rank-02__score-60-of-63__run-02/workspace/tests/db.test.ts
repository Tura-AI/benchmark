import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { addToCart, checkout, createTestDb, getAdminAnalytics, getCart, getCatalog, toggleFavorite } from '../src/server/db.server.ts'

describe('database marketplace calculations', () => {
  it('ranks featured prompts and exposes model/category counts', () => {
    const db = createTestDb()
    const catalog = getCatalog(db, { sort: 'featured' })

    assert.ok(catalog.prompts.length >= 12)
    assert.deepEqual(catalog.models, ['Claude', 'Flux', 'GPT-4o', 'Midjourney'])
    assert.equal(catalog.counts.free, 1)
    assert.ok(catalog.counts.featured > 8)
    assert.ok(catalog.prompts[0].rankScore > catalog.prompts.at(-1)!.rankScore)
    assert.ok(catalog.categories.find((cat) => cat.name === 'Image')!.revenue > 0)
  })

  it('calculates cart subtotal, fees, total, and checkout persistence in SQL', () => {
    const db = createTestDb()
    addToCart(db, 207)
    const cart = getCart(db)

    assert.ok(cart.subtotal >= 23)
    assert.ok(Math.abs(cart.fees - cart.subtotal * 0.06) < 0.02)
    assert.ok(Math.abs(cart.total - (cart.subtotal + cart.fees)) < 0.02)

    const result = checkout(db)
    assert.equal(result.ok, true)
    assert.equal(result.total, cart.total)
    assert.equal(getCart(db).items.length, 0)
  })

  it('computes creator revenue, category revenue, conversion, AOV, and trend rows', () => {
    const db = createTestDb()
    const analytics = getAdminAnalytics(db)

    assert.ok(analytics.summary.revenue > 0)
    assert.ok(analytics.summary.averageOrderValue > 0)
    assert.ok(analytics.summary.conversionRate > 0)
    assert.ok(analytics.creatorRevenue[0].revenue > analytics.creatorRevenue.at(-1)!.revenue)
    assert.equal(analytics.categoryRevenue.some((row) => row.category === 'Photography' && row.revenue > 0), true)
    assert.equal(analytics.dailySales.length, 8)
  })

  it('toggles favorites and filters favorites from the catalog', () => {
    const db = createTestDb()
    const before = getCatalog(db, { favorites: true }).counts.favorites
    const result = toggleFavorite(db, 160)
    const favorites = getCatalog(db, { favorites: true })

    assert.equal(result.favorite, true)
    assert.equal(favorites.counts.favorites, before + 1)
    assert.equal(favorites.prompts.some((prompt) => prompt.id === 160), true)
  })
})
