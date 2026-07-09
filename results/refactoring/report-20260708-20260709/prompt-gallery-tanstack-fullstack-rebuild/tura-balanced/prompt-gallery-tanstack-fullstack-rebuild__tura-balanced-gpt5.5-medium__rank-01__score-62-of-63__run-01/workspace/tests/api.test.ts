import { beforeEach, describe, expect, it } from 'vitest'

import { analyticsResponse, cartResponse, catalogResponse, promptResponse } from '../src/server/api'
import { resetDbForTests } from '../src/server/db'

async function parse(response: Response) {
  return response.json() as Promise<any>
}

describe('api route behavior', () => {
  beforeEach(() => resetDbForTests())

  it('filters catalog by model and search term', async () => {
    const data = await parse(await catalogResponse(new URL('http://local/api/prompts?model=Claude&q=voice')))
    expect(data.prompts).toHaveLength(1)
    expect(data.prompts[0].title).toBe('Brand Voice, Bottled')
  })

  it('returns prompt detail and 404 for missing prompts', async () => {
    const prompt = await parse(await promptResponse(207))
    expect(prompt.title).toBe('Cinematic Still, 35mm')
    const missing = await promptResponse(99999)
    expect(missing.status).toBe(404)
  })

  it('returns cart totals and analytics payloads', async () => {
    const cart = await parse(await cartResponse())
    expect(cart.totals.itemCount).toBe(2)
    const analytics = await parse(await analyticsResponse())
    expect(analytics.creatorRevenue.length).toBe(4)
    expect(analytics.categoryRevenue.length).toBeGreaterThan(3)
  })
})
