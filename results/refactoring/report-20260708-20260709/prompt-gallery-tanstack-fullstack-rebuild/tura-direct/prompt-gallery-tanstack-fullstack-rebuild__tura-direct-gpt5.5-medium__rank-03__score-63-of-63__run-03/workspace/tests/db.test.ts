import { expect, test } from 'vitest'
import { analytics, cartSummary, getDb, listPrompts } from '../src/lib/db'

test('database ranking, free filters, and cart totals are query-backed', () => {
  const db = getDb(':memory:')
  expect(listPrompts({ sort: 'featured' }, db)).toHaveLength(12)
  expect(listPrompts({ model: 'GPT-4o' }, db).every((p: any) => p.model === 'GPT-4o')).toBe(true)
  expect(listPrompts({ free: true }, db).map((p: any) => p.price_cents)).toEqual([0, 0])
  const cart = cartSummary(db)
  expect(cart.subtotal).toBe(3500)
  expect(cart.fee).toBe(175)
  expect(cart.total).toBe(3675)
})

test('analytics include revenue, conversion, categories, and daily trends', () => {
  const a = analytics(getDb(':memory:')) as any
  expect(a.totals.revenue).toBe(13545)
  expect(a.totals.orders).toBe(4)
  expect(a.creators[0].revenue).toBeGreaterThan(0)
  expect(a.categories.length).toBeGreaterThanOrEqual(3)
  expect(a.trends).toHaveLength(4)
  expect(a.conversion.rate).toBeGreaterThan(0)
})
