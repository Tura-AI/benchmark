import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkout, getCartTotals, toggleCart, toggleFavorite } from '../src/data/queries.server'
import { resetDbForTests } from '../src/data/db.server'
const path=resolve('data/test-api.sqlite')
beforeAll(()=>{process.env.POWERPROMPT_DB=path;if(existsSync(path))rmSync(path)})
afterAll(()=>{resetDbForTests();if(existsSync(path))rmSync(path);delete process.env.POWERPROMPT_DB})
describe('marketplace service boundary',()=>{
  it('persists favorite and cart mutations',()=>{expect(toggleFavorite(142).favorite).toBe(true);expect(toggleFavorite(142).favorite).toBe(false);expect(toggleCart(207).inCart).toBe(true);expect(getCartTotals().items.map(i=>i.id)).toContain(207)})
  it('creates a completed order and empties the cart atomically',()=>{const before=getCartTotals();const order=checkout();expect(order.total).toBe(before.total);expect(order.orderId).toBeGreaterThan(1006);expect(getCartTotals().items).toHaveLength(0)})
  it('rejects checkout on an empty cart',()=>expect(()=>checkout()).toThrow('Cart is empty'))
})
