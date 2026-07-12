import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { addToCart, checkout, getAnalytics, getCart, getPrompt, listCatalog, removeFromCart, toggleFavorite } from './queries';

const catalogInput = z.object({
  model: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(['Featured', 'Newest', 'Popular']).optional(),
  q: z.string().optional(),
  favorites: z.boolean().optional()
});

const promptInput = z.object({ promptId: z.string().min(1) });

export const getCatalogFn = createServerFn({ method: 'GET' })
  .validator((data: unknown) => catalogInput.parse(data ?? {}))
  .handler(({ data }) => listCatalog(data));

export const getPromptFn = createServerFn({ method: 'GET' })
  .validator((data: unknown) => promptInput.parse(data))
  .handler(({ data }) => getPrompt(data.promptId));

export const toggleFavoriteFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => promptInput.parse(data))
  .handler(({ data }) => toggleFavorite(data.promptId));

export const addToCartFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => promptInput.parse(data))
  .handler(({ data }) => addToCart(data.promptId));

export const removeFromCartFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => promptInput.parse(data))
  .handler(({ data }) => removeFromCart(data.promptId));

export const getCartFn = createServerFn({ method: 'GET' }).handler(() => getCart());

export const checkoutFn = createServerFn({ method: 'POST' }).handler(() => checkout());

export const getAnalyticsFn = createServerFn({ method: 'GET' }).handler(() => getAnalytics());
