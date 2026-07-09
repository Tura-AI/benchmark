import { describe, expect, it } from 'vitest'
import { createMemoryDb } from '../src/server/db'
import { addToCart, getPrompt, listCatalog, checkout } from '../src/server/queries'

describe('backend flow contracts', () => {
  it('filters catalog using source vocabulary', () => {
    const db = createMemoryDb()
    const flux = listCatalog(db, { model: 'Flux', sort: 'Popular' }) as any
    expect(flux.prompts.every((prompt: any) => prompt.model === 'Flux')).toBe(true)
    const favorites = listCatalog(db, { favoritesOnly: true }) as any
    expect(favorites.prompts.map((p: any) => p.id)).toContain('p-007')
  })

  it('loads prompt detail and supports checkout mutation flow', () => {
    const db = createMemoryDb()
    const prompt = getPrompt(db, 'p-012') as any
    expect(prompt.title).toMatch(/Serum/)
    addToCart(db, prompt.id)
    const order = checkout(db) as any
    expect(order.ok).toBe(true)
    expect(order.orderId).toMatch(/^ord-/)
  })
})
