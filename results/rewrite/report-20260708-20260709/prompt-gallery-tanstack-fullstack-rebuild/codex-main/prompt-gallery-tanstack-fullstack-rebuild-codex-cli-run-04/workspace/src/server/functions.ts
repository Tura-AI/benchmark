import { createServerFn } from '@tanstack/react-start'
import { addCartApi, analyticsApi, cartApi, checkoutApi, favoriteApi, promptDetailApi, removeCartApi, storefrontApi } from './api'

export const getStorefront = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const value = (input ?? {}) as Record<string, unknown>
    return {
      model: String(value.model ?? 'all'),
      category: String(value.category ?? 'all'),
      sort: String(value.sort ?? 'featured'),
      search: String(value.search ?? ''),
      favoritesOnly: value.favoritesOnly === true || value.favoritesOnly === 'true',
      freeOnly: value.freeOnly === true || value.freeOnly === 'true',
    }
  })
  .handler(({ data }) => storefrontApi(data), ({ data }) => storefrontApi(data))

export const getPromptDetail = createServerFn({ method: 'GET' })
  .validator((input: unknown) => Number((input as { id?: number | string }).id))
  .handler(({ data }) => promptDetailApi(data), ({ data }) => promptDetailApi(data))

export const getCartState = createServerFn({ method: 'GET' }).handler(() => cartApi(), () => cartApi())

export const getAnalyticsState = createServerFn({ method: 'GET' }).handler(() => analyticsApi(), () => analyticsApi())

export const favoritePrompt = createServerFn({ method: 'POST' })
  .validator((input: unknown) => Number((input as { promptId?: number | string }).promptId))
  .handler(({ data }) => favoriteApi(data), ({ data }) => favoriteApi(data))

export const addPromptToCart = createServerFn({ method: 'POST' })
  .validator((input: unknown) => Number((input as { promptId?: number | string }).promptId))
  .handler(({ data }) => addCartApi(data), ({ data }) => addCartApi(data))

export const removePromptFromCart = createServerFn({ method: 'POST' })
  .validator((input: unknown) => Number((input as { promptId?: number | string }).promptId))
  .handler(({ data }) => removeCartApi(data), ({ data }) => removeCartApi(data))

export const checkoutCart = createServerFn({ method: 'POST' }).handler(() => checkoutApi(), () => checkoutApi())
