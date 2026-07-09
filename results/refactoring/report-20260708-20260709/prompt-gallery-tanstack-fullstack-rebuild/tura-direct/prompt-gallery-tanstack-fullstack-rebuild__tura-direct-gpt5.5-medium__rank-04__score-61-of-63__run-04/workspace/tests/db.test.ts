import { beforeEach, describe, expect, it } from 'vitest'
import { addToCart, checkout, getAnalytics, getCartSummary, getCounts, listPrompts, resetForTests } from '../src/data/db'

describe('database calculations', () => {
  beforeEach(() => resetForTests())
  it('ranks featured prompts and exposes source vocabulary', () => {
    const prompts = listPrompts({ sort: 'Featured' })
    expect(prompts.length).toBeGreaterThanOrEqual(12)
    expect(new Set(prompts.map((p) => p.model)).size).toBeGreaterThanOrEqual(4)
    expect(prompts.some((p) => p.model === 'GPT-4o')).toBe(true)
    expect(prompts.some((p) => p.model === 'Claude')).toBe(true)
    expect(prompts[0].rankScore).toBeGreaterThan(prompts[6].rankScore)
  })
  it('computes free paid counts and cart totals in SQL-backed helpers', () => {
    const counts = getCounts()
    expect(counts.freeCount).toBe(1)
    expect(counts.paidCount).toBeGreaterThan(12)
    const cart = getCartSummary()
    expect(cart.subtotalCents).toBe(900)
    expect(cart.feesCents).toBe(72)
    expect(cart.totalCents).toBe(972)
    addToCart(301)
    expect(getCartSummary().totalCents).toBe(2484)
  })
  it('computes creator revenue, conversion, category revenue, AOV, and daily trends', () => {
    const analytics: any = getAnalytics()
    expect(analytics.summary.averageOrderValueCents).toBeGreaterThan(2500)
    expect(analytics.summary.conversionRate).toBeGreaterThan(0)
    expect(analytics.creatorRevenue.length).toBeGreaterThanOrEqual(4)
    expect(analytics.categoryRevenue.some((r: any) => r.category === 'Design')).toBe(true)
    expect(analytics.daily.length).toBe(5)
  })
  it('checkout creates an order and clears cart', () => {
    const result = checkout()
    expect(result.ok).toBe(true)
    expect(result.orderId).toBeGreaterThan(4)
    expect(getCartSummary().items).toHaveLength(0)
  })
})
