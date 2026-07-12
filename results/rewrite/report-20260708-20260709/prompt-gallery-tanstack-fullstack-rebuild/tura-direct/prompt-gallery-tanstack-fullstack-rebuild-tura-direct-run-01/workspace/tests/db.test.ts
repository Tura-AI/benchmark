import { describe, expect, it } from 'vitest';
import { getAnalytics, getCart, listCatalog } from '../src/server/queries';
import { db } from '../src/server/db';

describe('database calculations', () => {
  it('ranks featured prompts and exposes source vocabulary counts', () => {
    const catalog = listCatalog({ sort: 'Featured' });
    expect(catalog.prompts).toHaveLength(12);
    expect(catalog.models).toEqual(['GPT-4o', 'Claude', 'Midjourney', 'Flux']);
    expect(catalog.counts.featured).toBeGreaterThanOrEqual(4);
    expect(catalog.counts.free).toBe(2);
    expect(catalog.prompts[0].featured || catalog.prompts[0].sales > 1000).toBe(true);
  });

  it('computes cart subtotal, fees and total in SQL', () => {
    db.prepare("DELETE FROM cart_items WHERE user_id = 'user-demo'").run();
    db.prepare("INSERT INTO cart_items VALUES ('user-demo', 'cart-abandonment-agent', date())").run();
    db.prepare("INSERT INTO cart_items VALUES ('user-demo', 'makeup-macro-free', date())").run();
    const cart = getCart();
    expect(cart.items.map((item) => item.id)).toContain('cart-abandonment-agent');
    expect(cart.subtotalCents).toBe(3900);
    expect(cart.feeCents).toBe(195);
    expect(cart.totalCents).toBe(4095);
  });

  it('computes creator revenue, conversion, average price and trend summaries', () => {
    const analytics = getAnalytics();
    expect(analytics.creatorRevenue.length).toBe(4);
    expect(analytics.creatorRevenue[0].revenueCents).toBeGreaterThan(0);
    expect(analytics.creatorRevenue.some((row) => row.conversionRate > 0)).toBe(true);
    expect(analytics.averagePriceCents).toBeGreaterThan(1500);
    expect(analytics.categoryRevenue[0].revenueCents).toBeGreaterThan(0);
    expect(analytics.dailySales.length).toBeGreaterThanOrEqual(3);
  });
});
