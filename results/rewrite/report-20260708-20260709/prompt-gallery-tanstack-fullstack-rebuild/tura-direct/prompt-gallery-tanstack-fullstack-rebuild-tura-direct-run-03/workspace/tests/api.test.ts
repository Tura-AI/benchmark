import { expect, test } from 'vitest'
import { addToCart, cartSummary, checkout, getDb, toggleFavorite } from '../src/lib/db'

test('favorite and cart backend behavior mutates local database state', () => {
  const db = getDb(':memory:')
  expect(toggleFavorite('p2', db).favorite).toBe(true)
  addToCart('p1', db)
  const cart = cartSummary(db)
  expect(cart.items.some((i: any) => i.id === 'p1')).toBe(true)
  expect(cart.total).toBeGreaterThan(cart.subtotal)
})

test('checkout writes an order and clears the cart', () => {
  const db = getDb(':memory:')
  const order = checkout(db)
  expect(order.ok).toBe(true)
  expect(order.total).toBe(3675)
  expect(cartSummary(db).items).toHaveLength(0)
})
