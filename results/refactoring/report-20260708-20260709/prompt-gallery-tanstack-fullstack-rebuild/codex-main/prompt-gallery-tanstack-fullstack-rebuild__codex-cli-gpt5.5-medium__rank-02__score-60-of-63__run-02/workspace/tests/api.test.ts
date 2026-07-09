import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { handleCatalogRequest, handleCartRequest, handleCheckoutRequest } from '../src/server/api.server.ts'

describe('Start API route handlers', () => {
  it('returns filtered catalog data for API consumers', async () => {
    const res = await handleCatalogRequest(new Request('http://localhost/api/catalog?model=GPT-4o&sort=popular'))
    const data = await res.json()

    assert.equal(res.status, 200)
    assert.ok(data.prompts.length > 0)
    assert.equal(data.prompts.every((prompt: { model: string }) => prompt.model === 'GPT-4o'), true)
    assert.ok(data.counts.cart >= 0)
  })

  it('validates cart mutation payloads', async () => {
    const bad = await handleCartRequest(new Request('http://localhost/api/cart', { method: 'POST', body: '{}' }))
    assert.equal(bad.status, 400)

    const good = await handleCartRequest(
      new Request('http://localhost/api/cart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'add', promptId: 207 }),
      }),
    )
    const data = await good.json()
    assert.equal(good.status, 200)
    assert.equal(data.items.some((item: { id: number }) => item.id === 207), true)
  })

  it('simulates checkout through the API boundary', async () => {
    await handleCartRequest(
      new Request('http://localhost/api/cart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'add', promptId: 301 }),
      }),
    )
    const res = await handleCheckoutRequest()
    const data = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.ok, true)
    assert.ok(data.orderId)
  })
})
