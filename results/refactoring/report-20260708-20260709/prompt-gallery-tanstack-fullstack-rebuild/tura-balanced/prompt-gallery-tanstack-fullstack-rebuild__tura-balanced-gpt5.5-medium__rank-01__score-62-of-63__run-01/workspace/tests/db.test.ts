import { beforeEach, describe, expect, it } from 'vitest'

import { resetDbForTests } from '../src/server/db'
import { addToCart, getAnalytics, getCart, getCatalog } from '../src/server/queries'

describe('database calculations', () => {
  beforeEach(() => resetDbForTests())

  it('ranks prompts and counts paid/free/featured rows in SQL', async () => {
    const catalog = await getCatalog({ sort: 'featured' })
    expect(catalog.prompts).toHaveLength(22)
    expect(catalog.counts.free).toBe(1)
    expect(catalog.counts.paid).toBe(21)
    expect(catalog.counts.featured).toBeGreaterThan(8)
    expect(catalog.prompts[0].rankScore).toBeGreaterThan(catalog.prompts.at(-1)!.rankScore)
  })

  it('calculates cart subtotal, fee, and total from database rows', async () => {
    const cart = await getCart()
    expect(cart.totals.subtotal).toBe(21)
    expect(cart.totals.fee).toBe(2.1)
    expect(cart.totals.total).toBe(23.1)
    await addToCart(301)
    const updated = await getCart()
    expect(updated.totals.subtotal).toBe(35)
    expect(updated.totals.total).toBe(38.5)
  })

  it('computes creator revenue, conversion, category revenue, and daily trend summaries', async () => {
    const analytics = await getAnalytics()
    expect(analytics.overview.revenue).toBe(145.2)
    expect(analytics.overview.averageOrderValue).toBe(48.4)
    expect(analytics.overview.averagePrice).toBeGreaterThan(12)
    expect(analytics.creatorRevenue[0].revenue).toBeGreaterThan(analytics.creatorRevenue.at(-1)!.revenue)
    expect(analytics.categoryRevenue.find((row) => row.category === 'Image')?.revenue).toBeGreaterThan(40)
    expect(analytics.dailySales).toHaveLength(3)
  })
})
