import { createServerFn } from '@tanstack/react-start'
import { cartInput, catalogInput, checkoutInput, promptIdInput } from '~/contracts'
import { getDatabase } from './db.server'
import { addCartItem, checkout, getAnalytics, getCartSummary, getCatalogCounts, getPrompt, listPrompts, removeCartItem, toggleFavorite } from './queries.server'

export const getCatalog = createServerFn({ method: 'GET' })
  .validator((input) => catalogInput.parse(input ?? {}))
  .handler(({ data }) => ({ prompts: listPrompts(getDatabase(), data), counts: getCatalogCounts(getDatabase()), cart: getCartSummary(getDatabase()) }))

export const getPromptDetail = createServerFn({ method: 'GET' })
  .validator((input) => promptIdInput.parse(input))
  .handler(({ data }) => getPrompt(getDatabase(), data.promptId))

export const getCart = createServerFn({ method: 'GET' }).handler(() => getCartSummary(getDatabase()))
export const getCreatorAnalytics = createServerFn({ method: 'GET' }).handler(() => getAnalytics(getDatabase()))

export const favoritePrompt = createServerFn({ method: 'POST' })
  .validator((input) => promptIdInput.parse(input))
  .handler(({ data }) => toggleFavorite(getDatabase(), data.promptId))

export const addPromptToCart = createServerFn({ method: 'POST' })
  .validator((input) => cartInput.parse(input))
  .handler(({ data }) => addCartItem(getDatabase(), data.promptId, data.quantity))

export const removePromptFromCart = createServerFn({ method: 'POST' })
  .validator((input) => promptIdInput.parse(input))
  .handler(({ data }) => removeCartItem(getDatabase(), data.promptId))

export const checkoutCart = createServerFn({ method: 'POST' })
  .validator((input) => checkoutInput.parse(input))
  .handler(({ data }) => checkout(getDatabase(), data.email))
