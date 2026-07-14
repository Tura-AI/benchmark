import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarketplaceDb } from '../src/data/db.server'

describe('marketplace SQL calculations', () => {
  let market: MarketplaceDb
  beforeEach(() => { market = new MarketplaceDb(':memory:') })
  afterEach(() => market.close())

  it('seeds the required marketplace relationships', () => {
    expect((market.db.prepare('SELECT COUNT(*) n FROM prompts').get() as { n: number }).n).toBe(22)
    expect((market.db.prepare('SELECT COUNT(*) n FROM creators').get() as { n: number }).n).toBe(4)
    expect((market.db.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n).toBe(8)
    expect((market.db.prepare('SELECT COUNT(*) n FROM orders').get() as { n: number }).n).toBe(8)
  })

  it('ranks and filters catalog rows in SQL', () => {
    const featured = market.listCatalog({ sort: 'featured' })
    expect(featured.prompts[0].title).toBe('The Socratic Tutor')
    expect(featured.prompts[0].rankScore).toBeGreaterThan(featured.prompts[1].rankScore)
    expect(featured.counts).toEqual({ all: 22, free: 1, paid: 21, favorites: 2 })
    expect(market.listCatalog({ model: 'Claude' }).prompts.every((p) => p.model === 'Claude')).toBe(true)
    expect(market.listCatalog({ price: 'free' }).prompts.map((p) => p.title)).toEqual(['The Socratic Tutor'])
    expect(market.listCatalog({ search: 'cold email' }).prompts).toHaveLength(1)
  })

  it('calculates cart subtotal, fee, total, and quantity in SQL', () => {
    expect(market.getCart()).toMatchObject({ subtotal: 14, fee: 0.7, total: 14.7, count: 1 })
    const cart = market.addToCart(207)
    expect(cart).toMatchObject({ subtotal: 23, fee: 1.15, total: 24.15, count: 2 })
    expect(market.setCartQuantity(207, 3)).toMatchObject({ subtotal: 41, fee: 2.05, total: 43.05, count: 4 })
  })

  it('derives revenue, conversion, averages, categories and daily trends in SQL', () => {
    const result = market.analytics()
    expect(result.summary).toEqual({ revenue: 240, creatorRevenue: 204, orders: 7, conversionRate: 2.52, averageOrderValue: 34.29, averagePromptPrice: 12.41 })
    expect(result.daily).toHaveLength(7)
    expect(result.daily.reduce((sum, day) => sum + day.sales, 0)).toBe(240)
    expect(result.categories.length).toBeGreaterThanOrEqual(6)
    expect(result.categories[0].revenue).toBeGreaterThan(result.categories.at(-1)!.revenue)
    expect(result.creators).toHaveLength(4)
    expect(result.topPrompts[0]).toMatchObject({ title: "The Worldbuilder's Bible", revenue: 29 })
  })
})
