import { createServerFn } from '@tanstack/react-start'
import { getDb } from './db'
import { addToCart, analytics, checkout, getCart, getPrompt, listCatalog, removeFromCart, toggleFavorite, CatalogInput } from './queries'

export const getCatalog = createServerFn({ method: 'GET' })
  .validator((input: unknown) => CatalogInput.partial().parse(input ?? {}))
  .handler(({ data }) => listCatalog(getDb(), data))

export const getPromptDetail = createServerFn({ method: 'GET' })
  .validator((input: unknown) => String(input ?? ''))
  .handler(({ data }) => getPrompt(getDb(), data))

export const toggleFavoriteAction = createServerFn({ method: 'POST' })
  .validator((input: unknown) => String(input ?? ''))
  .handler(({ data }) => toggleFavorite(getDb(), data))

export const addCartAction = createServerFn({ method: 'POST' })
  .validator((input: unknown) => String(input ?? ''))
  .handler(({ data }) => addToCart(getDb(), data))

export const removeCartAction = createServerFn({ method: 'POST' })
  .validator((input: unknown) => String(input ?? ''))
  .handler(({ data }) => removeFromCart(getDb(), data))

export const getCartState = createServerFn({ method: 'GET' }).handler(() => getCart(getDb()))

export const checkoutAction = createServerFn({ method: 'POST' }).handler(() => checkout(getDb()))

export const getAnalytics = createServerFn({ method: 'GET' }).handler(() => analytics(getDb()))
