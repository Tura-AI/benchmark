import { describe, expect, it } from 'vitest'
import { analyticsResponse, catalogResponse } from '~/server/api.server'

describe('public backend contracts', () => {
  it('returns validated filtered catalog data and metadata', () => {
    const response = catalogResponse({ model: 'Claude', sort: 'popular', category: 'all', query: '', favoritesOnly: false, price: 'all' })
    expect(response.data.length).toBeGreaterThan(0)
    expect(response.data.every((prompt) => prompt.model === 'Claude')).toBe(true)
    expect(response.data[0].rating).toBeGreaterThanOrEqual(response.data.at(-1)!.rating)
    expect(response.meta.total).toBe(22)
  })

  it('rejects unknown model vocabulary', () => {
    expect(() => catalogResponse({ model: 'Unknown' })).toThrow()
  })

  it('returns SQL-backed analytics DTOs', () => {
    const { data } = analyticsResponse()
    expect(data.overview.orders).toBeGreaterThanOrEqual(6)
    expect(data.overview.conversion_rate).toBe(20)
    expect(data.overview.average_order_value).toBeGreaterThan(0)
    expect(data.creators[0].revenue).toBeGreaterThanOrEqual(data.creators.at(-1)!.revenue)
    expect(data.daily.length).toBeGreaterThanOrEqual(6)
    expect(data.daily[0].day <= data.daily.at(-1)!.day).toBe(true)
  })
})
