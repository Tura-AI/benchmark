import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, seed } from '../src/db/schema'
import { addToCart, checkout, getAnalytics, getCart, getFilterCounts, listPrompts, toggleFavorite } from '../src/db/queries'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  seed(db)
})

describe('database calculations', () => {
  it('ranks featured prompts ahead using database score', () => {
    const rows = listPrompts({ sort: 'featured' }, db)
    expect(rows.length).toBeGreaterThanOrEqual(12)
    expect(rows[0].rankScore).toBeGreaterThan(rows[rows.length - 1].rankScore)
    expect(rows.some((row) => row.model === 'GPT-4o')).toBe(true)
  })

  it('calculates filter counts and free/favorite totals', () => {
    const counts = getFilterCounts('user_demo', db)
    expect(counts.free).toBe(1)
    expect(counts.favorites).toBe(3)
    expect(counts.cart).toBe(2)
  })

  it('calculates cart subtotal fee and total from rows', () => {
    const cart = getCart('user_demo', db)
    expect(cart.subtotalCents).toBe(2100)
    expect(cart.feeCents).toBe(168)
    expect(cart.totalCents).toBe(2268)
  })

  it('updates favorites, cart, checkout, and analytics', () => {
    expect(toggleFavorite(142, 'user_demo', db).isFavorite).toBe(true)
    expect(addToCart(142, 'user_demo', db).count).toBe(3)
    const result = checkout('user_demo', db)
    expect(result.ok).toBe(true)
    expect(getCart('user_demo', db).count).toBe(0)
    const analytics = getAnalytics(db)
    expect(analytics.summary.revenueCents).toBeGreaterThan(8900)
    expect(analytics.creatorRevenue.length).toBe(4)
    expect(analytics.categoryRevenue.length).toBe(8)
    expect(analytics.dailySales.length).toBeGreaterThan(1)
  })
})
