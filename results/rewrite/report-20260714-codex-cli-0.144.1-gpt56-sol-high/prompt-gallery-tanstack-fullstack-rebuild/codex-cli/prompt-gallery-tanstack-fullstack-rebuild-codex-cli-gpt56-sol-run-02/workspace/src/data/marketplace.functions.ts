import { createServerFn } from '@tanstack/react-start'
import type { SortKey } from './types'
import { serverAddCart, serverAnalytics, serverCart, serverCatalog, serverCheckout, serverPrompt, serverToggleFavorite, serverUpdateCart } from './server-boundary'

type CatalogInput = { model?: string; category?: string; sort?: SortKey; search?: string; favorites?: boolean; price?: 'all' | 'free' | 'paid' }

export const getCatalog = createServerFn({ method: 'GET' })
  .validator((data: CatalogInput = {}) => data)
  .handler(({ data }) => serverCatalog(data))

export const getPromptDetail = createServerFn({ method: 'GET' })
  .validator((data: { slug: string }) => data)
  .handler(({ data }) => serverPrompt(data.slug))

export const toggleFavorite = createServerFn({ method: 'POST' })
  .validator((data: { promptId: number }) => data)
  .handler(({ data }) => serverToggleFavorite(data.promptId))

export const addCartItem = createServerFn({ method: 'POST' })
  .validator((data: { promptId: number }) => data)
  .handler(({ data }) => serverAddCart(data.promptId))

export const updateCartItem = createServerFn({ method: 'POST' })
  .validator((data: { promptId: number; quantity: number }) => data)
  .handler(({ data }) => serverUpdateCart(data.promptId, data.quantity))

export const getCart = createServerFn({ method: 'GET' }).handler(() => serverCart())
export const runCheckout = createServerFn({ method: 'POST' }).handler(() => serverCheckout())
export const getAnalytics = createServerFn({ method: 'GET' }).handler(() => serverAnalytics())
