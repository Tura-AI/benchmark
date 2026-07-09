import { describe, expect, it, beforeEach } from 'vitest'
import { addCartItem, analytics, getCart, listPrompts, resetDbForTests, toggleFavorite } from '../src/server/db'

beforeEach(() => {
  resetDbForTests()
})

describe('database marketplace calculations', () => {
  it('ranks featured prompts with database-side score', () => {
    const prompts = listPrompts({ sort: 'featured' })
    expect(prompts.length).toBeGreaterThanOrEqual(12)
    expect(prompts[0].rankScore).toBeGreaterThan(prompts.at(-1)!.rankScore)
    expect(prompts.map((p) => p.model)).toContain('GPT-4o')
    expect(prompts.map((p) => p.model)).toContain('Claude')
  })

  it('filters free and favorite rows in SQL', () => {
    const free = listPrompts({ freeOnly: true })
    expect(free).toHaveLength(1)
    expect(free[0].title).toBe('The Socratic Tutor')
    const favs = listPrompts({ favoritesOnly: true })
    expect(favs.every((p) => p.isFavorite === 1)).toBe(true)
    toggleFavorite(207)
    expect(listPrompts({ favoritesOnly: true }).some((p) => p.id === 207)).toBe(true)
  })

  it('calculates cart subtotal, fee, and total in SQL', () => {
    addCartItem(301)
    const cart = getCart()
    expect(cart.totals.subtotal).toBe(35)
    expect(cart.totals.fee).toBe(2.1)
    expect(cart.totals.total).toBe(37.1)
    expect(cart.totals.count).toBe(3)
  })

  it('calculates creator, category, conversion, AOV, and daily summaries', () => {
    const data = analytics()
    expect(data.summary.grossRevenue).toBeGreaterThan(0)
    expect(data.summary.averageOrderValue).toBeGreaterThan(0)
    expect(data.summary.conversionRate).toBeGreaterThan(0)
    expect(data.creators).toHaveLength(4)
    expect(data.categories.some((c) => c.name === 'Photography' && c.revenue > 0)).toBe(true)
    expect(data.daily.length).toBeGreaterThanOrEqual(8)
  })
})
