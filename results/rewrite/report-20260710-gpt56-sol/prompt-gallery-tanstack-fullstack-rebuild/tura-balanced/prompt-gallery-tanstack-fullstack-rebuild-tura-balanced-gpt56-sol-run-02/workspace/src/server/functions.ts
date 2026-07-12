import { createServerFn } from '@tanstack/react-start'
import { catalogInputSchema, promptIdSchema } from '../contracts/marketplace'
import { addCartItem, analytics, catalog, checkout, getCart, getDatabase, getPrompt, removeCartItem, toggleFavorite } from './db'

export const getCatalogFn = createServerFn({ method: 'GET' }).validator(catalogInputSchema).handler(({ data }) => catalog(getDatabase(), data))
export const getPromptFn = createServerFn({ method: 'GET' }).validator(promptIdSchema).handler(({ data }) => getPrompt(getDatabase(), data.promptId))
export const favoriteFn = createServerFn({ method: 'POST' }).validator(promptIdSchema).handler(({ data }) => toggleFavorite(getDatabase(), data.promptId))
export const addCartFn = createServerFn({ method: 'POST' }).validator(promptIdSchema).handler(({ data }) => addCartItem(getDatabase(), data.promptId))
export const removeCartFn = createServerFn({ method: 'POST' }).validator(promptIdSchema).handler(({ data }) => removeCartItem(getDatabase(), data.promptId))
export const getCartFn = createServerFn({ method: 'GET' }).handler(() => getCart(getDatabase()))
export const checkoutFn = createServerFn({ method: 'POST' }).handler(() => checkout(getDatabase()))
export const getAnalyticsFn = createServerFn({ method: 'GET' }).handler(() => analytics(getDatabase()))
