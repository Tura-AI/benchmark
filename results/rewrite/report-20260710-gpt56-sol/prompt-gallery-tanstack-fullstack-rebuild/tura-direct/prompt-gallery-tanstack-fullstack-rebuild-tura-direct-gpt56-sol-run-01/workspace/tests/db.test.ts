import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type PowerPromptDb } from '../src/server/db'
import { getAnalytics, getCart, getCatalog, setCartQuantity } from '../src/server/queries'

describe('database calculations', () => {
  let db: PowerPromptDb
  beforeEach(() => { db=createDatabase() })
  afterEach(() => db.close())
  it('ranks featured prompts and returns database filter counts', () => {
    const result=getCatalog(db,{model:'all',category:'all',sort:'featured',search:'',favorites:false,free:false})
    expect(result.prompts).toHaveLength(22); expect(result.prompts[0].rank).toBe(1); expect(result.prompts[0].featured).toBe(1)
    expect(result.counts).toMatchObject({total:22,free:1,paid:21})
  })
  it('calculates cart subtotal, fee, and total in SQL', () => {
    setCartQuantity(db,207,2); setCartQuantity(db,160,1)
    expect(getCart(db)).toMatchObject({itemCount:3,subtotal:36,fee:2.88,total:38.88})
  })
  it('summarizes creator and category revenue from order rows', () => {
    const data=getAnalytics(db,2)
    expect(data.creator.revenue).toBe(44); expect(data.creator.orders).toBe(2); expect(data.creator.averageOrderValue).toBe(22)
    expect(data.categories[0].revenue).toBeGreaterThan(0); expect(data.daily).toHaveLength(3)
  })
})
