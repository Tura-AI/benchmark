import {
  addCartItem,
  analytics,
  checkout,
  getCart,
  getPrompt,
  listCategories,
  listPrompts,
  removeCartItem,
  toggleFavorite,
} from './db'

export function storefrontApi(input: {
  model?: string
  category?: string
  sort?: string
  search?: string
  favoritesOnly?: boolean
  freeOnly?: boolean
} = {}) {
  return {
    prompts: listPrompts(input),
    categories: listCategories(),
    cart: getCart(),
  }
}

export function promptDetailApi(id: number) {
  return { prompt: getPrompt(id), cart: getCart() }
}

export const cartApi = () => getCart()
export const analyticsApi = () => analytics()
export const favoriteApi = (promptId: number) => toggleFavorite(promptId)
export const addCartApi = (promptId: number) => addCartItem(promptId)
export const removeCartApi = (promptId: number) => removeCartItem(promptId)
export const checkoutApi = () => checkout()
