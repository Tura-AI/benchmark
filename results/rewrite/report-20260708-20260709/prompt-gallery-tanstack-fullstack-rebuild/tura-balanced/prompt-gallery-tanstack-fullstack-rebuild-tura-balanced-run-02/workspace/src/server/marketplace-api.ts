import { USER_ID } from '@/db/seed'
import {
  addToCart,
  checkout,
  getAnalytics,
  getCart,
  getCategories,
  getFilterCounts,
  getPrompt,
  listPrompts,
  removeFromCart,
  toggleFavorite,
  type CatalogFilters,
} from '@/db/queries'

export function storefrontApi(data: CatalogFilters = {}) {
  return {
    prompts: listPrompts({ ...data, userId: USER_ID }),
    categories: getCategories(),
    counts: getFilterCounts(USER_ID),
    cart: getCart(USER_ID),
  }
}

export function promptDetailApi(promptId: number) {
  const prompt = getPrompt(promptId, USER_ID)
  if (!prompt) throw new Error('Prompt not found')
  return { prompt, cart: getCart(USER_ID) }
}

export function toggleFavoriteApi(promptId: number) {
  return { favorite: toggleFavorite(promptId, USER_ID), counts: getFilterCounts(USER_ID) }
}

export function addCartApi(promptId: number) {
  return { cart: addToCart(promptId, USER_ID) }
}

export function removeCartApi(promptId: number) {
  return { cart: removeFromCart(promptId, USER_ID) }
}

export function checkoutApi() {
  return checkout(USER_ID)
}

export function cartStateApi() {
  return getCart(USER_ID)
}

export function creatorAnalyticsApi() {
  return getAnalytics()
}
