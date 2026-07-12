import type { CatalogFilters } from '../db/database'

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response.json() as Promise<T>
}

export const fallbackFilters = {
  models: [
    { model: 'Claude', count: 0 },
    { model: 'Flux', count: 0 },
    { model: 'GPT-4o', count: 0 },
    { model: 'Midjourney', count: 0 },
  ],
  categories: [
    'Image',
    'Photography',
    'Design',
    'Writing',
    'Code',
    'Marketing',
    'Productivity',
    'Research',
  ].map((category) => ({ category, count: 0 })),
  counts: { featured: 0, free: 0, paid: 0, favorites: 0, cart: 0 },
}

export function getMarketplace({ data }: { data?: CatalogFilters } = {}) {
  const params = new URLSearchParams()
  Object.entries(data ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== false && value !== '') params.set(key, String(value))
  })
  return requestJson<{ prompts: unknown[]; filters: typeof fallbackFilters }>(
    `/api/marketplace?${params}`,
  )
}

export function getPromptDetail({ data }: { data: { promptId: number } }) {
  return requestJson(`/api/prompts/${data.promptId}`)
}

export function toggleFavoriteFn({ data }: { data: { promptId: number } }) {
  return requestJson<{ isFavorite: boolean }>('/api/favorite', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function addToCartFn({ data }: { data: { promptId: number } }) {
  return requestJson<{ items: Array<{ quantity: number }> }>('/api/cart', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function removeFromCartFn({ data }: { data: { promptId: number } }) {
  return requestJson('/api/cart/remove', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function getCartFn() {
  return requestJson<{ items: unknown[]; totals: { subtotal: number; platformFee: number; total: number } }>(
    '/api/cart',
  )
}

export function checkoutFn() {
  return requestJson<{ ok: boolean; orderId: number | null; cart: Awaited<ReturnType<typeof getCartFn>> }>(
    '/api/checkout',
    { method: 'POST' },
  )
}

export function getAnalyticsFn() {
  return requestJson('/api/analytics')
}
