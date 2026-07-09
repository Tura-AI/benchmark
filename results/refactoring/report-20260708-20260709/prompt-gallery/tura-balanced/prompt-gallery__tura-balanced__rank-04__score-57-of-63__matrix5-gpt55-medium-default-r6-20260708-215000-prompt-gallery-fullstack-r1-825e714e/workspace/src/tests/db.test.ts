import { describe, expect, it } from 'vitest'
import { createConnection } from '../server/db'
import { addToCart, checkout, getAnalytics, getCart, getFilterCounts, listPrompts } from '../server/queries'

function memoryDb() {
  return createConnection(`data/test-${crypto.randomUUID()}.json`)
}

describe('database calculations', () => {
  it('ranks featured prompts and preserves source vocabulary filters', () => {
    const db = memoryDb()
    const prompts = listPrompts({ model: 'GPT-4o', sort: 'featured' }, db)
    expect(prompts.length).toBeGreaterThan(3)
    expect(prompts.every((prompt) => prompt.model === 'GPT-4o')).toBe(true)
    expect(prompts[0].rankScore).toBeGreaterThanOrEqual(prompts[1].rankScore)
  })

  it('computes free, paid, and featured counts in SQL', () => {
    const counts = getFilterCounts(memoryDb())
    expect(counts.free).toBeGreaterThanOrEqual(1)
    expect(counts.paid).toBeGreaterThan(12)
    expect(counts.featured).toBeGreaterThan(8)
  })

  it('computes cart subtotal, fees, and total from database rows', () => {
    const db = memoryDb()
    addToCart(207, db)
    const cart = getCart(db)
    expect(cart.totals.itemCount).toBeGreaterThanOrEqual(2)
    expect(cart.totals.total).toBeCloseTo(cart.totals.subtotal + cart.totals.fees, 2)
  })

  it('records checkout and clears the cart', () => {
    const db = memoryDb()
    const result = checkout(db)
    expect(result.ok).toBe(true)
    expect(getCart(db).totals.itemCount).toBe(0)
  })

  it('computes creator revenue, conversion, AOV, category revenue, and trends', () => {
    const analytics = getAnalytics(memoryDb())
    expect(analytics.totals.revenue).toBeGreaterThan(0)
    expect(analytics.totals.conversionRate).toBeGreaterThan(0)
    expect(analytics.totals.averageOrderValue).toBeGreaterThan(0)
    expect(analytics.creatorRevenue.length).toBeGreaterThanOrEqual(4)
    expect(analytics.categoryRevenue.length).toBeGreaterThanOrEqual(4)
    expect(analytics.dailySales.length).toBeGreaterThanOrEqual(6)
  })
})
