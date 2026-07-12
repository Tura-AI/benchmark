import type { AppDb, DbPrompt, DbState } from './db'
import { getDb } from './db'
import { userId } from './seed'
import type { AnalyticsSummary, CartTotals, CatalogFilters, PromptCard } from './types'

function dbOrDefault(db?: AppDb) {
  return db ?? getDb()
}

export function listCategories(db?: AppDb) {
  return dbOrDefault(db).read().categories.map(({ name }) => ({ name }))
}

export function listPrompts(filters: CatalogFilters = {}, db?: AppDb) {
  const state = dbOrDefault(db).read()
  return state.prompts
    .filter((prompt) => matchesFilters(prompt, state, filters))
    .map((prompt) => toPromptCard(prompt, state))
    .sort(sortPrompts(filters.sort ?? 'featured'))
}

export function getPrompt(slugOrId: string | number, db?: AppDb) {
  const state = dbOrDefault(db).read()
  const prompt = state.prompts.find((item) => item.slug === String(slugOrId) || item.id === Number(slugOrId))
  return prompt ? toPromptCard(prompt, state) : undefined
}

export function getFilterCounts(db?: AppDb) {
  const prompts = dbOrDefault(db).read().prompts
  return {
    free: prompts.filter((prompt) => prompt.price === 0).length,
    paid: prompts.filter((prompt) => prompt.price > 0).length,
    featured: prompts.filter((prompt) => prompt.sold >= 2000).length,
  }
}

export function toggleFavorite(promptId: number, db?: AppDb) {
  return dbOrDefault(db).transaction((state) => {
    const index = state.favorites.findIndex((row) => row.userId === userId && row.promptId === promptId)
    if (index >= 0) {
      state.favorites.splice(index, 1)
      return false
    }
    state.favorites.push({ userId, promptId })
    return true
  })
}

export function addToCart(promptId: number, db?: AppDb) {
  dbOrDefault(db).transaction((state) => {
    if (!state.cartItems.some((row) => row.userId === userId && row.promptId === promptId)) {
      state.cartItems.push({ userId, promptId, quantity: 1 })
    }
  })
  return getCart(db)
}

export function removeFromCart(promptId: number, db?: AppDb) {
  dbOrDefault(db).transaction((state) => {
    state.cartItems = state.cartItems.filter((row) => !(row.userId === userId && row.promptId === promptId))
  })
  return getCart(db)
}

export function getCart(db?: AppDb) {
  const state = dbOrDefault(db).read()
  const items = state.cartItems
    .filter((row) => row.userId === userId)
    .map((row) => state.prompts.find((prompt) => prompt.id === row.promptId))
    .filter(Boolean)
    .map((prompt) => toPromptCard(prompt!, state))
    .sort((a, b) => a.title.localeCompare(b.title))
  const subtotal = items.reduce((sum, item) => sum + item.price, 0)
  const fees = roundMoney(subtotal * 0.08)
  const totals: CartTotals = { subtotal, fees, total: roundMoney(subtotal + fees), itemCount: items.length }
  return { items, totals }
}

export function checkout(db?: AppDb) {
  const conn = dbOrDefault(db)
  const cart = getCart(conn)
  if (!cart.items.length) return { ok: false, orderId: null, cart }
  const orderId = conn.transaction((state) => {
    const next = Math.max(0, ...state.orders.map((order) => order.id)) + 1
    state.orders.push({ id: next, userId, createdAt: new Date().toISOString(), subtotal: cart.totals.subtotal, fees: cart.totals.fees, total: cart.totals.total })
    cart.items.forEach((item) => {
      const prompt = state.prompts.find((row) => row.id === item.id)!
      const category = state.categories.find((row) => row.name === prompt.category)!
      state.orderItems.push({ orderId: next, promptId: prompt.id, price: prompt.price, creatorId: prompt.creatorId, categoryId: category.id })
    })
    state.cartItems = state.cartItems.filter((row) => row.userId !== userId)
    return next
  })
  return { ok: true, orderId, cart: getCart(conn) }
}

export function getAnalytics(db?: AppDb): AnalyticsSummary {
  const state = dbOrDefault(db).read()
  const sessionCount = state.sessions.length || 1
  const converted = state.sessions.filter((session) => session.converted).length
  const creatorRevenue = state.creators
    .map((creator) => {
      const rows = state.orderItems.filter((item) => item.creatorId === creator.id)
      return {
        creator: creator.name,
        revenue: roundMoney(rows.reduce((sum, item) => sum + item.price * creator.commissionRate, 0)),
        sales: rows.length,
        conversionRate: roundRatio(rows.length / sessionCount),
        averageOrderValue: roundMoney(rows.reduce((sum, item) => sum + item.price, 0) / Math.max(1, new Set(rows.map((item) => item.orderId)).size)),
      }
    })
    .filter((row) => row.sales > 0)
    .sort((a, b) => b.revenue - a.revenue)
  const categoryRevenue = state.categories
    .map((category) => {
      const rows = state.orderItems.filter((item) => item.categoryId === category.id)
      return { category: category.name, revenue: roundMoney(rows.reduce((sum, item) => sum + item.price, 0)), sales: rows.length }
    })
    .filter((row) => row.sales > 0)
    .sort((a, b) => b.revenue - a.revenue)
  const dailyMap = new Map<string, { revenue: number; orders: number }>()
  state.orders.forEach((order) => {
    const day = order.createdAt.slice(0, 10)
    const row = dailyMap.get(day) ?? { revenue: 0, orders: 0 }
    row.revenue += order.total
    row.orders += 1
    dailyMap.set(day, row)
  })
  const dailySales = [...dailyMap.entries()].map(([day, row]) => ({ day, revenue: roundMoney(row.revenue), orders: row.orders })).sort((a, b) => a.day.localeCompare(b.day))
  const revenue = roundMoney(state.orders.reduce((sum, order) => sum + order.total, 0))
  return {
    creatorRevenue,
    categoryRevenue,
    dailySales,
    totals: { revenue, orders: state.orders.length, conversionRate: roundRatio(converted / sessionCount), averageOrderValue: roundMoney(revenue / Math.max(1, state.orders.length)) },
  }
}

function matchesFilters(prompt: DbPrompt, state: DbState, filters: CatalogFilters) {
  if (filters.model && filters.model !== 'all' && prompt.model !== filters.model) return false
  if (filters.category && filters.category !== 'all' && prompt.category !== filters.category) return false
  if (filters.favoritesOnly && !state.favorites.some((row) => row.userId === userId && row.promptId === prompt.id)) return false
  if (filters.priceMode === 'free' && prompt.price !== 0) return false
  if (filters.priceMode === 'paid' && prompt.price <= 0) return false
  if (filters.term) {
    const creator = state.creators.find((row) => row.id === prompt.creatorId)?.name ?? ''
    const haystack = `${prompt.title} ${prompt.model} ${prompt.category} ${prompt.description} ${creator}`.toLowerCase()
    if (!haystack.includes(filters.term.toLowerCase())) return false
  }
  return true
}

function sortPrompts(sort: NonNullable<CatalogFilters['sort']>) {
  return (a: PromptCard, b: PromptCard) => {
    if (sort === 'newest') return b.id - a.id
    if (sort === 'popular') return b.rating - a.rating || b.sold - a.sold
    return b.rankScore - a.rankScore || b.sold - a.sold
  }
}

function toPromptCard(prompt: DbPrompt, state: DbState): PromptCard {
  return {
    id: prompt.id,
    slug: prompt.slug,
    title: prompt.title,
    model: prompt.model,
    category: prompt.category,
    price: prompt.price,
    sold: prompt.sold,
    rating: prompt.rating,
    creator: state.creators.find((creator) => creator.id === prompt.creatorId)?.name ?? 'POWERPROMPT',
    aspectRatio: prompt.aspectRatio,
    description: prompt.description,
    imageUrl: prompt.imageUrl,
    isFavorite: state.favorites.some((row) => row.userId === userId && row.promptId === prompt.id),
    inCart: state.cartItems.some((row) => row.userId === userId && row.promptId === prompt.id),
    rankScore: roundMoney(prompt.sold * 0.68 + prompt.rating * 280 + (prompt.price === 0 ? 320 : 0)),
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function roundRatio(value: number) {
  return Math.round(value * 1000) / 1000
}
