import { createServerFn } from '@tanstack/react-start'
import {
  addToCart,
  checkout,
  getAnalytics,
  getCart,
  getCatalog,
  getPrompt,
  getShellData,
  removeFromCart,
  toggleFavorite,
  type CatalogFilters,
} from './data/db'

export const api = {
  shell: () => getShellData(),
  catalog: (filters: CatalogFilters) => getCatalog(filters),
  prompt: (id: number) => getPrompt(id),
  cart: () => getCart(),
  toggleFavorite: (id: number) => toggleFavorite(id),
  addToCart: (id: number) => addToCart(id),
  removeFromCart: (id: number) => removeFromCart(id),
  checkout: () => checkout(),
  analytics: () => getAnalytics(),
}

export const getShell = createServerFn({ method: 'GET' }).handler(() => api.shell())

export const getCatalogServer = createServerFn({ method: 'GET' })
  .validator((data: CatalogFilters) => data)
  .handler(({ data }) => api.catalog(data))

export const getPromptServer = createServerFn({ method: 'GET' })
  .validator((id: number) => id)
  .handler(({ data }) => api.prompt(data))

export const getCartServer = createServerFn({ method: 'GET' }).handler(() => api.cart())

export const toggleFavoriteServer = createServerFn({ method: 'POST' })
  .validator((id: number) => id)
  .handler(({ data }) => api.toggleFavorite(data))

export const addToCartServer = createServerFn({ method: 'POST' })
  .validator((id: number) => id)
  .handler(({ data }) => api.addToCart(data))

export const removeFromCartServer = createServerFn({ method: 'POST' })
  .validator((id: number) => id)
  .handler(({ data }) => api.removeFromCart(data))

export const checkoutServer = createServerFn({ method: 'POST' }).handler(() => api.checkout())

export const getAnalyticsServer = createServerFn({ method: 'GET' }).handler(() => api.analytics())
