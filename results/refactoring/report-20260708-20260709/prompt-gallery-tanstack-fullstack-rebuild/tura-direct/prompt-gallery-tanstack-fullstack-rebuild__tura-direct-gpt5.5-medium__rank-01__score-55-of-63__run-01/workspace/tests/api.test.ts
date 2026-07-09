import { describe, expect, it } from 'vitest';
import { addToCart, getPrompt, listCatalog, toggleFavorite } from '../src/server/queries';

describe('backend behavior boundary', () => {
  it('filters catalog by model and search text', () => {
    const catalog = listCatalog({ model: 'GPT-4o', q: 'cart', sort: 'Popular' });
    expect(catalog.prompts.length).toBeGreaterThan(0);
    expect(catalog.prompts.every((prompt) => prompt.model === 'GPT-4o')).toBe(true);
    expect(catalog.prompts.some((prompt) => prompt.title.includes('Cart'))).toBe(true);
  });

  it('mutates favorites and cart through server query functions', () => {
    const before = getPrompt('shade-name-system');
    const toggled = toggleFavorite('shade-name-system');
    expect(toggled?.isFavorite).toBe(!before?.isFavorite);
    toggleFavorite('shade-name-system');
    const cart = addToCart('shade-name-system');
    expect(cart.items.some((item) => item.id === 'shade-name-system')).toBe(true);
  });
});
