import { createServerOnlyFn } from '@tanstack/react-start'
import type { SortKey } from './types'

export const serverCatalog = createServerOnlyFn(async (input: { model?: string; category?: string; sort?: SortKey; search?: string; favorites?: boolean; price?: 'all' | 'free' | 'paid' } = {}) => (await import('./db.server')).getDb().listCatalog(input))
export const serverPrompt = createServerOnlyFn(async (slug: string) => (await import('./db.server')).getDb().getPrompt(slug))
export const serverToggleFavorite = createServerOnlyFn(async (promptId: number) => (await import('./db.server')).getDb().toggleFavorite(promptId))
export const serverAddCart = createServerOnlyFn(async (promptId: number) => (await import('./db.server')).getDb().addToCart(promptId))
export const serverUpdateCart = createServerOnlyFn(async (promptId: number, quantity: number) => (await import('./db.server')).getDb().setCartQuantity(promptId, quantity))
export const serverCart = createServerOnlyFn(async () => (await import('./db.server')).getDb().getCart())
export const serverCheckout = createServerOnlyFn(async () => (await import('./db.server')).getDb().checkout())
export const serverAnalytics = createServerOnlyFn(async () => (await import('./db.server')).getDb().analytics())

export const serverCatalogApi = createServerOnlyFn(async (request: Request) => (await import('./api.server')).handleCatalogRequest(request))
export const serverCartApi = createServerOnlyFn(async (request: Request) => (await import('./api.server')).handleCartRequest(request))
export const serverCheckoutApi = createServerOnlyFn(async () => (await import('./api.server')).handleCheckoutRequest())
export const serverFavoriteApi = createServerOnlyFn(async (request: Request) => (await import('./api.server')).handleFavoriteRequest(request))
