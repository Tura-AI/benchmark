import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { catalogInput } from '../src/contracts'
import { createDatabase, type PowerPromptDb } from '../src/server/db'
import { checkout, getCart, getCatalog, setCartQuantity, toggleFavorite } from '../src/server/queries'

describe('backend contracts and flows', () => {
  let db: PowerPromptDb
  beforeEach(() => { db=createDatabase() }); afterEach(() => db.close())
  it('validates and applies API catalog filters', () => {
    const input=catalogInput.parse({model:'Flux',sort:'popular'})
    const result=getCatalog(db,input)
    expect(result.prompts.length).toBeGreaterThan(3); expect(result.prompts.every((prompt)=>prompt.model==='Flux')).toBe(true)
  })
  it('persists favorite mutations', () => {
    expect(toggleFavorite(db,233).favorite).toBe(true)
    expect(getCatalog(db,{model:'all',category:'all',sort:'featured',search:'',favorites:true,free:false}).prompts.map((p)=>p.id)).toContain(233)
  })
  it('persists checkout and clears the cart atomically', () => {
    setCartQuantity(db,301,1); const order=checkout(db)
    expect(order.orderId).toBe(4); expect(order.total).toBe(15.12); expect(getCart(db).itemCount).toBe(0)
    expect(db.prepare('SELECT status FROM orders WHERE id=?').get(order.orderId)).toEqual({status:'paid'})
  })
})
