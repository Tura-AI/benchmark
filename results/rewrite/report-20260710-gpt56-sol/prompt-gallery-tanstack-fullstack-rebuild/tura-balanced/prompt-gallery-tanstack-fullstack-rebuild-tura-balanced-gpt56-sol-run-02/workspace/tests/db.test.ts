import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { addCartItem, analytics, catalog, checkout, createDatabase, getCart, listPrompts, toggleFavorite } from '../src/server/db'

let db: DatabaseSync
const defaults = { model: 'all', category: 'all', sort: 'featured', q: '', favorites: false, free: false } as const
beforeEach(() => { db = createDatabase(':memory:') })
afterEach(() => db.close())

describe('marketplace SQL calculations', () => {
  it('ranks featured prompts and computes filter counts', () => {
    const result = catalog(db, defaults)
    expect(result.prompts).toHaveLength(12)
    expect(result.counts).toMatchObject({ total: 12, featured: 8, free: 2 })
    expect(result.prompts[0].rankScore).toBeGreaterThan(result.prompts.at(-1)!.rankScore)
    expect(listPrompts(db, { ...defaults, free: true })).toHaveLength(2)
  })
  it('filters search, models, and persistent favorites', () => {
    expect(listPrompts(db, { ...defaults, model: 'Claude' })).toHaveLength(2)
    expect(listPrompts(db, { ...defaults, q: 'watercolor' })[0].id).toBe('watercolor-cityscape')
    toggleFavorite(db, 'plot-doctor')
    expect(listPrompts(db, { ...defaults, favorites: true }).map((p) => p.id)).toContain('plot-doctor')
  })
  it('computes subtotal, fee, total, and creates a completed order', () => {
    addCartItem(db, 'sculptural-interiors')
    const cart = getCart(db)
    expect(cart).toMatchObject({ itemCount: 2, subtotalCents: 2100, feeCents: 105, totalCents: 2205 })
    const receipt = checkout(db)
    expect(receipt.totalCents).toBe(2205)
    expect(getCart(db).itemCount).toBe(0)
  })
  it('calculates creator revenue, conversion, AOV, category and daily trends in SQL', () => {
    const data = analytics(db) as any
    expect(data.overview).toMatchObject({ grossRevenueCents: 8925, completedOrders: 6, conversionRate: 9.28 })
    expect(data.overview.averageOrderValueCents).toBe(1488)
    expect(data.creators[0]).toMatchObject({ name: 'Forme Studio', grossCents: 3800, revenueCents: 3230 })
    expect(data.categories.some((row: any) => row.name === 'Design')).toBe(true)
    expect(data.daily).toHaveLength(6)
  })
})
