import { describe, expect, it } from 'vitest'
import { createMemoryDb } from '../src/server/db'
import { addToCart, analytics, checkout, getCart, listCatalog, removeFromCart, toggleFavorite } from '../src/server/queries'

describe('database marketplace calculations', () => {
  it('ranks featured prompts and exposes filter counts', () => {
    const db = createMemoryDb()
    const data = listCatalog(db, { sort: 'Featured' }) as any
    expect(data.prompts).toHaveLength(12)
    expect(data.counts.featured).toBe(6)
    expect(data.counts.free).toBe(2)
    expect(data.prompts[0].rank_score).toBeGreaterThan(data.prompts[11].rank_score)
  })

  it('calculates cart subtotal, fees, totals, and checkout clearing in SQL', () => {
    const db = createMemoryDb()
    addToCart(db, 'p-001')
    removeFromCart(db, 'p-002')
    const cart = getCart(db) as any
    expect(cart.totals.subtotalCents).toBe(4300)
    expect(cart.totals.feeCents).toBe(258)
    expect(cart.totals.totalCents).toBe(4558)
    const order = checkout(db) as any
    expect(order.ok).toBe(true)
    expect((getCart(db) as any).totals.itemCount).toBe(0)
  })

  it('calculates creator revenue, category revenue, conversion, and daily trends', () => {
    const db = createMemoryDb()
    const report = analytics(db) as any
    expect(report.summary.averageOrderValueCents).toBeGreaterThan(3000)
    expect(report.summary.conversionRate).toBeGreaterThan(0)
    expect(report.creatorRevenue[0].revenueCents).toBeGreaterThan(0)
    expect(report.categoryRevenue[0].sales).toBeGreaterThan(0)
    expect(report.dailySales).toHaveLength(4)
  })

  it('persists favorite toggles for the demo user', () => {
    const db = createMemoryDb()
    const off = toggleFavorite(db, 'p-001') as any
    const on = toggleFavorite(db, 'p-001') as any
    expect(off.favorite).toBe(false)
    expect(on.favorite).toBe(true)
  })
})
