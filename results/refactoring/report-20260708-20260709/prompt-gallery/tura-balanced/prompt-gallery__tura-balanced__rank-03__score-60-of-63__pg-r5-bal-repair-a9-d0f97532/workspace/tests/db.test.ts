import { describe, expect, test, beforeEach } from 'vitest'
import { addToCart, checkout, getAnalytics, getCartSummary, getDatabasePath, getStorefront, resetDatabase } from '../src/data/db'

beforeEach(() => resetDatabase())

describe('database calculations', () => {
  test('seeds required marketplace rows', () => {
    const catalog = getStorefront()
    expect(catalog.prompts.length).toBeGreaterThanOrEqual(12)
    expect(catalog.categories.length).toBeGreaterThanOrEqual(8)
    expect(catalog.counts.free).toBeGreaterThanOrEqual(1)
    expect(getDatabasePath()).toContain('powerprompt.db.json')
  })

  test('ranks featured prompts with database query score', () => {
    const catalog = getStorefront({ sort: 'featured' })
    expect(catalog.prompts[0].rankScore).toBeGreaterThanOrEqual(catalog.prompts[1].rankScore)
    expect(catalog.prompts.some((prompt) => prompt.model === 'GPT-4o')).toBe(true)
  })

  test('computes filter counts and cart totals', () => {
    const catalog = getStorefront({ free: true })
    expect(catalog.prompts.every((prompt) => prompt.price === 0)).toBe(true)
    const cart = getCartSummary()
    expect(cart.subtotal).toBe(12)
    expect(cart.fee).toBe(0.96)
    expect(cart.total).toBe(12.96)
  })

  test('computes creator revenue, conversion, category revenue, AOV, and trends', () => {
    const analytics = getAnalytics()
    expect(analytics.creatorRevenue.length).toBe(4)
    expect(analytics.categoryRevenue[0].revenue).toBeGreaterThan(0)
    expect(analytics.averageOrderValue).toBe(39.31)
    expect(analytics.conversionRate).toBe(2.66)
    expect(analytics.dailySales.length).toBeGreaterThanOrEqual(5)
    expect(analytics.trend.at(-1)?.change).toBeGreaterThan(0)
  })

  test('checkout persists a new order and clears cart', () => {
    addToCart(207)
    const order = checkout()
    expect(order.orderId).toBe(6)
    expect(getCartSummary().count).toBe(0)
    expect(getAnalytics().orderCount).toBe(6)
  })
})
