import { createServerFn } from '@tanstack/react-start'
import { catalogInput, idInput, quantityInput } from '../contracts'
import { getDatabase } from './db'
import { checkout, getAnalytics, getCart, getCatalog, getPrompt, setCartQuantity, toggleFavorite } from './queries'

export const catalogFn = createServerFn({ method: 'GET' }).validator(catalogInput).handler(({ data }) => getCatalog(getDatabase(), data))
export const promptFn = createServerFn({ method: 'GET' }).validator(idInput).handler(({ data }) => getPrompt(getDatabase(), data.promptId))
export const cartFn = createServerFn({ method: 'GET' }).handler(() => getCart(getDatabase()))
export const favoriteFn = createServerFn({ method: 'POST' }).validator(idInput).handler(({ data }) => toggleFavorite(getDatabase(), data.promptId))
export const cartQuantityFn = createServerFn({ method: 'POST' }).validator(quantityInput).handler(({ data }) => setCartQuantity(getDatabase(), data.promptId, data.quantity))
export const checkoutFn = createServerFn({ method: 'POST' }).handler(() => checkout(getDatabase()))
export const analyticsFn = createServerFn({ method: 'GET' }).handler(() => getAnalytics(getDatabase()))
