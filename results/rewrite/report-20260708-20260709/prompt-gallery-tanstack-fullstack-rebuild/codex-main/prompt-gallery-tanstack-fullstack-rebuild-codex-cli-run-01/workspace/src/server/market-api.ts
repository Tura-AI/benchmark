import {
  addToCart,
  checkout,
  getAnalytics,
  getCart,
  getFilters,
  getPrompt,
  listPrompts,
  removeFromCart,
  toggleFavorite,
  type CatalogFilters,
} from '../db/database.ts'

export const marketApi = {
  marketplace: async (data: CatalogFilters = {}) => {
    const [prompts, filters] = await Promise.all([listPrompts(data), getFilters()])
    return { prompts, filters }
  },
  promptDetail: (promptId: number) => getPrompt(promptId),
  toggleFavorite: (promptId: number) => toggleFavorite(promptId),
  addToCart: (promptId: number) => addToCart(promptId),
  removeFromCart: (promptId: number) => removeFromCart(promptId),
  cart: () => getCart(),
  checkout: () => checkout(),
  analytics: () => getAnalytics(),
}
