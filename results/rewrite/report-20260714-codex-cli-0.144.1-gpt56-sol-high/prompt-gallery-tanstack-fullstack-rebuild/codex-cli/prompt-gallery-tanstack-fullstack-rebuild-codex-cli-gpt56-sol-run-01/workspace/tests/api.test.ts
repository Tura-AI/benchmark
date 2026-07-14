import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/server/db.server'
import { cartResponse, catalogResponse, favoriteResponse } from '../src/server/api.server'

describe('marketplace API boundary', () => {
  let db: DatabaseSync
  beforeEach(() => { db = openDatabase(':memory:') })
  afterEach(() => db?.close())

  it('returns filtered catalog JSON', async () => {
    const response = catalogResponse(db, new Request('http://local/api/prompts?model=Flux&sort=newest'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.prompts.length).toBeGreaterThan(3)
    expect(body.prompts.every((p: any) => p.model === 'Flux')).toBe(true)
  })

  it('validates and persists favorite requests', async () => {
    const invalid = await favoriteResponse(db, new Request('http://local/api/favorites', { method: 'POST', body: '{}' }))
    expect(invalid.status).toBe(400)
    const response = await favoriteResponse(db, new Request('http://local/api/favorites', { method: 'POST', body: JSON.stringify({promptId:233}) }))
    expect(await response.json()).toMatchObject({ favorite: true, count: 3 })
    const favorites = await catalogResponse(db, new Request('http://local/api/prompts?favorites=true')).json()
    expect(favorites.prompts.some((p: any) => p.id === 233)).toBe(true)
  })

  it('adds to cart and returns server-calculated totals', async () => {
    const response = await cartResponse(db, new Request('http://local/api/cart', { method: 'POST', body: JSON.stringify({promptId:207}) }))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ count: 2, subtotal: 21, fee: 1.26, total: 22.26 })
    const read = await cartResponse(db, new Request('http://local/api/cart'))
    expect((await read.json()).items).toHaveLength(2)
  })
})
