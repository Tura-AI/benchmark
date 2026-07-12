import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { catalogResponse } from '../src/server/api'
import * as database from '../src/server/db'

let db: DatabaseSync
beforeEach(() => { db = database.createDatabase(':memory:'); vi.spyOn(database, 'getDatabase').mockReturnValue(db) })
afterEach(() => { vi.restoreAllMocks(); db.close() })

describe('catalog API route', () => {
  it('returns filtered backend data', async () => {
    const response = catalogResponse(new Request('http://local/api/catalog?model=Flux&sort=popular'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.prompts).toHaveLength(3)
    expect(body.prompts.every((prompt: any) => prompt.model === 'Flux')).toBe(true)
    expect(body.counts.free).toBe(2)
  })
  it('rejects unsupported vocabulary', async () => {
    const response = catalogResponse(new Request('http://local/api/catalog?model=Unknown'))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Invalid catalog query')
  })
})
