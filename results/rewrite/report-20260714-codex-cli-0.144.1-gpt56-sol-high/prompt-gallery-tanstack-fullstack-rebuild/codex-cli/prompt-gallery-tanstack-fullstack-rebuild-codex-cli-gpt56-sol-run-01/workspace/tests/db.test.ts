import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { addToCart, checkout, getAnalytics, getCart, listCatalog, openDatabase, removeFromCart } from '../src/server/db.server'

describe('SQLite marketplace calculations', () => {
  let db: DatabaseSync
  beforeEach(() => { db = openDatabase(':memory:') })
  afterEach(() => db?.close())

  it('seeds and ranks a complete prompt catalog', () => {
    const catalog = listCatalog(db)
    expect(catalog.prompts).toHaveLength(22)
    expect(catalog.categories).toHaveLength(8)
    expect(catalog.counts).toEqual({ all: 22, featured: 8, free: 1, favorites: 2 })
    expect(catalog.prompts[0].rankScore).toBeGreaterThan(catalog.prompts.at(-1)!.rankScore)
  })

  it('performs model, free, search, and popularity filters in SQL', () => {
    expect(listCatalog(db, { model: 'Claude' }).prompts.every((p) => p.model === 'Claude')).toBe(true)
    expect(listCatalog(db, { free: true }).prompts.map((p) => p.title)).toEqual(['The Socratic Tutor'])
    expect(listCatalog(db, { term: 'cold email' }).prompts[0].slug).toBe('cold-email-closer')
    const popular = listCatalog(db, { sort: 'popular' }).prompts
    expect(popular[0].rating).toBeGreaterThanOrEqual(popular[1].rating)
  })

  it('calculates cart subtotal, fee, and total from joined rows', () => {
    addToCart(db, 207)
    const cart = getCart(db)
    expect(cart.count).toBe(2)
    expect(cart.subtotal).toBe(21)
    expect(cart.fee).toBe(1.26)
    expect(cart.total).toBe(22.26)
    removeFromCart(db, 207)
    expect(getCart(db).total).toBe(12.72)
  })

  it('creates order and sales rows transactionally at checkout', () => {
    addToCart(db, 233)
    const result = checkout(db)
    expect(result.orderId).toBeGreaterThan(12)
    expect(getCart(db).count).toBe(0)
    const itemCount = db.prepare('SELECT COUNT(*) count FROM order_items WHERE order_id=?').get(result.orderId) as { count: number }
    expect(itemCount.count).toBe(2)
  })

  it('aggregates creator, category, conversion, AOV, and daily trends', () => {
    const analytics = getAnalytics(db)
    expect(analytics.overview.grossRevenue).toBeGreaterThan(0)
    expect(analytics.overview.averageOrderValue).toBeGreaterThan(0)
    expect(analytics.overview.conversionRate).toBeGreaterThan(0)
    expect(analytics.creators).toHaveLength(8)
    expect(analytics.categories).toHaveLength(8)
    expect(analytics.daily).toHaveLength(14)
    expect(analytics.daily.reduce((sum: number, day: any) => sum + day.orders, 0)).toBe(12)
  })
})
