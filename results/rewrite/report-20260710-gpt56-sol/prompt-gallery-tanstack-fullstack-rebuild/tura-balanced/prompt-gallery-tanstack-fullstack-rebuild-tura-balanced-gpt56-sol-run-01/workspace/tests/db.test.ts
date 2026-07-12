import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '~/server/db.server'
import { addCartItem, checkout, getAnalytics, getCartSummary, getCatalogCounts, listPrompts, toggleFavorite } from '~/server/queries.server'

let db: Database.Database
beforeEach(() => { db = openDatabase(':memory:') })
afterEach(() => db.close())

describe('database calculations', () => {
  it('seeds a complete relational marketplace', () => {
    expect((db.prepare('SELECT COUNT(*) AS count FROM prompts').get() as { count: number }).count).toBe(22)
    expect((db.prepare('SELECT COUNT(*) AS count FROM creators').get() as { count: number }).count).toBe(4)
    expect((db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number }).count).toBe(8)
    expect((db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }).count).toBe(6)
  })

  it('ranks and filters prompts in SQL', () => {
    const featured = listPrompts(db, { model: 'all', category: 'all', sort: 'featured', query: '', favoritesOnly: false, price: 'all' })
    expect(featured).toHaveLength(22)
    expect(featured[0].rankScore).toBeGreaterThanOrEqual(featured[1].rankScore)
    const free = listPrompts(db, { model: 'all', category: 'all', sort: 'featured', query: '', favoritesOnly: false, price: 'free' })
    expect(free).toHaveLength(1)
    expect(free[0].title).toBe('The Socratic Tutor')
    expect(getCatalogCounts(db)).toMatchObject({ total: 22, free: 1, paid: 21 })
  })

  it('persists favorites and computes cart totals in SQL', () => {
    expect(toggleFavorite(db, 233)).toMatchObject({ favorite: true, count: 3 })
    addCartItem(db, 207, 2)
    const cart = getCartSummary(db)
    expect(cart.itemCount).toBe(3)
    expect(cart.subtotal).toBe(30)
    expect(cart.serviceFee).toBe(1.5)
    expect(cart.total).toBe(31.5)
  })

  it('checks out atomically and updates analytics', () => {
    const before = getAnalytics(db)
    const result = checkout(db, 'buyer@example.com')
    expect(result.orderId).toBeGreaterThan(6)
    expect(getCartSummary(db).items).toHaveLength(0)
    const after = getAnalytics(db)
    expect(after.overview.orders).toBe(before.overview.orders + 1)
    expect(after.overview.revenue).toBeGreaterThan(before.overview.revenue)
    expect(after.creators).toHaveLength(4)
    expect(after.categories).toHaveLength(8)
    expect(after.daily.length).toBeGreaterThan(0)
  })
})
