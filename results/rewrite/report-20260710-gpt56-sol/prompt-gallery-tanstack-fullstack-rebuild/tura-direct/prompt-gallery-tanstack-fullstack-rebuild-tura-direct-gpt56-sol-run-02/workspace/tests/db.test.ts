import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAnalytics, getCartTotals, listPrompts } from '../src/data/queries.server'
import { resetDbForTests } from '../src/data/db.server'

const path=resolve('data/test-db.sqlite')
beforeAll(()=>{process.env.POWERPROMPT_DB=path;if(existsSync(path))rmSync(path)})
afterAll(()=>{resetDbForTests();if(existsSync(path))rmSync(path);delete process.env.POWERPROMPT_DB})
describe('database calculations',()=>{
  it('ranks and filters the seeded catalog in SQL',()=>{const all=listPrompts({sort:'featured'});expect(all).toHaveLength(22);expect(all[0].featured).toBe(1);expect(listPrompts({model:'Claude'}).every(p=>p.model==='Claude')).toBe(true);expect(listPrompts({price:'free'}).map(p=>p.id)).toEqual([31])})
  it('calculates cart subtotal, fee, and total',()=>{const cart=getCartTotals();expect(cart.subtotal).toBe(12);expect(cart.fee).toBe(.96);expect(cart.total).toBe(12.96)})
  it('aggregates creator, category, AOV, and daily revenue',()=>{const a=getAnalytics();expect(a.summary.revenue).toBe(126.36);expect(a.summary.averageOrderValue).toBe(21.06);expect(a.creators).toHaveLength(4);expect(a.categories.some(c=>c.revenue>0)).toBe(true);expect(a.daily.length).toBeGreaterThan(3)})
})
