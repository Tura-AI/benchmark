import { createServerFn } from '@tanstack/react-start'

import { categories, type ModelName, type SortName, userId } from '../data/seed'

async function dbAccess() {
  return import('./db')
}

export type PromptRow = {
  id: number
  title: string
  model: ModelName
  category: string
  price: number
  sold: number
  rating: number
  creatorId: string
  creator: string
  handle: string
  aspect: string
  featured: number
  createdAt: string
  description: string
  imageUrl: string
  rankScore: number
  isFavorite: number
  inCart: number
}

export type CatalogFilters = {
  model?: ModelName | 'all'
  category?: string | 'all'
  sort?: SortName
  q?: string
  favoritesOnly?: boolean
  freeOnly?: boolean
}

const orderBy: Record<SortName, string> = {
  featured: 'p.featured DESC, rankScore DESC, p.sold DESC',
  newest: 'p.created_at DESC, p.id DESC',
  popular: 'p.rating DESC, p.sold DESC',
}

function imageUrl(id: number, aspect: string) {
  const [w, h] = aspect.split('/').map(Number)
  const width = 640
  const height = Math.round((width * h) / w)
  return `https://picsum.photos/seed/pp${id}/${width}/${height}`
}

function normalizePrompt(row: Omit<PromptRow, 'imageUrl'>): PromptRow {
  return { ...row, imageUrl: imageUrl(row.id, row.aspect) }
}

export async function getCatalog(filters: CatalogFilters = {}) {
  const { getDb, sql } = await dbAccess()
  const db = await getDb()
  const where = ['1=1']
  const params: unknown[] = [userId, userId]
  if (filters.model && filters.model !== 'all') {
    where.push('p.model = ?')
    params.push(filters.model)
  }
  if (filters.category && filters.category !== 'all') {
    where.push('p.category = ?')
    params.push(filters.category)
  }
  if (filters.q) {
    where.push('(LOWER(p.title || " " || p.model || " " || p.category || " " || p.description) LIKE ?)')
    params.push(`%${filters.q.toLowerCase()}%`)
  }
  if (filters.favoritesOnly) where.push('f.prompt_id IS NOT NULL')
  if (filters.freeOnly) where.push('p.price = 0')

  const rows = sql.all<Omit<PromptRow, 'imageUrl'>>(
    db,
    `SELECT p.id, p.title, p.model, p.category, p.price, p.sold, p.rating,
      p.creator_id AS creatorId, c.name AS creator, c.handle, p.aspect, p.featured,
      p.created_at AS createdAt, p.description,
      ROUND((p.rating * 1000) + (p.sold * 0.08) + (p.featured * 850) - (p.price * 4), 2) AS rankScore,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS isFavorite,
      CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END AS inCart
    FROM prompts p
    JOIN creators c ON c.id = p.creator_id
    LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
    LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = ?
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy[filters.sort ?? 'featured']}`,
    params,
  )

  const counts = sql.first<{ total: number; free: number; paid: number; featured: number }>(
    db,
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN price = 0 THEN 1 ELSE 0 END) AS free,
      SUM(CASE WHEN price > 0 THEN 1 ELSE 0 END) AS paid,
      SUM(featured) AS featured
     FROM prompts`,
  ) ?? { total: 0, free: 0, paid: 0, featured: 0 }
  return { prompts: rows.map(normalizePrompt), categories, counts }
}

export async function getPrompt(id: number) {
  const { getDb, sql } = await dbAccess()
  const db = await getDb()
  const prompt = sql.first<Omit<PromptRow, 'imageUrl'>>(
    db,
    `SELECT p.id, p.title, p.model, p.category, p.price, p.sold, p.rating,
      p.creator_id AS creatorId, c.name AS creator, c.handle, p.aspect, p.featured,
      p.created_at AS createdAt, p.description,
      ROUND((p.rating * 1000) + (p.sold * 0.08) + (p.featured * 850) - (p.price * 4), 2) AS rankScore,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS isFavorite,
      CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END AS inCart
     FROM prompts p
     JOIN creators c ON c.id = p.creator_id
     LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
     LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = ?
     WHERE p.id = ?`,
    [userId, userId, id],
  )
  return prompt ? normalizePrompt(prompt) : null
}

export async function getCart() {
  const { getDb, sql } = await dbAccess()
  const db = await getDb()
  const items = sql.all<PromptRow & { quantity: number; lineTotal: number }>(
    db,
    `SELECT p.id, p.title, p.model, p.category, p.price, p.sold, p.rating,
      p.creator_id AS creatorId, c.name AS creator, c.handle, p.aspect, p.featured,
      p.created_at AS createdAt, p.description, ci.quantity,
      ROUND((p.rating * 1000) + (p.sold * 0.08) + (p.featured * 850) - (p.price * 4), 2) AS rankScore,
      1 AS inCart,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS isFavorite,
      ROUND(p.price * ci.quantity, 2) AS lineTotal
     FROM cart_items ci
     JOIN prompts p ON p.id = ci.prompt_id
     JOIN creators c ON c.id = p.creator_id
     LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ci.user_id
     WHERE ci.user_id = ?
     ORDER BY p.created_at DESC`,
    [userId],
  ).map((row) => ({ ...row, imageUrl: imageUrl(row.id, row.aspect) }))
  const totals = sql.first<{ subtotal: number; fee: number; total: number; itemCount: number }>(
    db,
    `SELECT ROUND(COALESCE(SUM(p.price * ci.quantity), 0), 2) AS subtotal,
      ROUND(COALESCE(SUM(p.price * ci.quantity), 0) * 0.1, 2) AS fee,
      ROUND(COALESCE(SUM(p.price * ci.quantity), 0) * 1.1, 2) AS total,
      COALESCE(SUM(ci.quantity), 0) AS itemCount
     FROM cart_items ci
     JOIN prompts p ON p.id = ci.prompt_id
     WHERE ci.user_id = ?`,
    [userId],
  ) ?? { subtotal: 0, fee: 0, total: 0, itemCount: 0 }
  return { items, totals }
}

export async function toggleFavorite(promptId: number) {
  const { getDb, sql } = await dbAccess()
  const db = await getDb()
  const existing = sql.first<{ promptId: number }>(db, 'SELECT prompt_id AS promptId FROM favorites WHERE user_id = ? AND prompt_id = ?', [userId, promptId])
  if (existing) {
    sql.run(db, 'DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?', [userId, promptId])
    sql.persist(db)
    return { isFavorite: false }
  }
  sql.run(db, 'INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)', [userId, promptId])
  sql.persist(db)
  return { isFavorite: true }
}

export async function addToCart(promptId: number) {
  const { getDb, sql } = await dbAccess()
  const db = await getDb()
  sql.run(
    db,
    `INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (?, ?, 1)
     ON CONFLICT(user_id, prompt_id) DO UPDATE SET quantity = quantity + 1`,
    [userId, promptId],
  )
  sql.persist(db)
  return getCart()
}

export async function checkoutCart() {
  const { getDb, sql } = await dbAccess()
  const db = await getDb()
  const cart = await getCart()
  if (cart.totals.itemCount === 0) return { ok: false, orderId: null, ...cart }
  const orderId = `ord_${Date.now()}`
  const today = new Date().toISOString().slice(0, 10)
  sql.run(db, 'INSERT INTO orders (id, user_id, created_at, subtotal, fee, total) VALUES (?, ?, ?, ?, ?, ?)', [orderId, userId, today, cart.totals.subtotal, cart.totals.fee, cart.totals.total])
  for (const item of cart.items) {
    sql.run(db, 'INSERT INTO order_items (order_id, prompt_id, quantity, price) VALUES (?, ?, ?, ?)', [orderId, item.id, item.quantity, item.price])
  }
  sql.run(db, 'DELETE FROM cart_items WHERE user_id = ?', [userId])
  sql.persist(db)
  return { ok: true, orderId, ...(await getCart()) }
}

export async function getAnalytics() {
  const { getDb, sql } = await dbAccess()
  const db = await getDb()
  const overview = sql.first<{ revenue: number; orders: number; averageOrderValue: number; conversionRate: number; averagePrice: number }>(
    db,
    `SELECT ROUND(SUM(total), 2) AS revenue,
      COUNT(*) AS orders,
      ROUND(AVG(total), 2) AS averageOrderValue,
      ROUND(COUNT(*) * 1.0 / (SELECT COUNT(*) FROM users), 2) AS conversionRate,
      ROUND((SELECT AVG(price) FROM prompts WHERE price > 0), 2) AS averagePrice
     FROM orders`,
  ) ?? { revenue: 0, orders: 0, averageOrderValue: 0, conversionRate: 0, averagePrice: 0 }
  const creatorRevenue = sql.all<{ creator: string; revenue: number; payout: number; units: number }>(
    db,
    `SELECT c.name AS creator,
      ROUND(SUM(oi.price * oi.quantity), 2) AS revenue,
      ROUND(SUM(oi.price * oi.quantity) * c.payout_rate, 2) AS payout,
      SUM(oi.quantity) AS units
     FROM order_items oi
     JOIN prompts p ON p.id = oi.prompt_id
     JOIN creators c ON c.id = p.creator_id
     GROUP BY c.id
     ORDER BY revenue DESC`,
  )
  const categoryRevenue = sql.all<{ category: string; revenue: number; units: number }>(
    db,
    `SELECT p.category,
      ROUND(SUM(oi.price * oi.quantity), 2) AS revenue,
      SUM(oi.quantity) AS units
     FROM order_items oi
     JOIN prompts p ON p.id = oi.prompt_id
     GROUP BY p.category
     ORDER BY revenue DESC`,
  )
  const dailySales = sql.all<{ day: string; revenue: number; orders: number }>(
    db,
    `SELECT created_at AS day, ROUND(SUM(total), 2) AS revenue, COUNT(*) AS orders
     FROM orders
     GROUP BY created_at
     ORDER BY created_at`,
  )
  return { overview, creatorRevenue, categoryRevenue, dailySales }
}

export const getCatalogFn = createServerFn({ method: 'GET' }).validator((data: CatalogFilters) => data).handler(({ data }) => getCatalog(data))
export const getPromptFn = createServerFn({ method: 'GET' }).validator((id: number) => id).handler(({ data }) => getPrompt(data))
export const getCartFn = createServerFn({ method: 'GET' }).handler(() => getCart())
export const getAnalyticsFn = createServerFn({ method: 'GET' }).handler(() => getAnalytics())
export const toggleFavoriteFn = createServerFn({ method: 'POST' }).validator((id: number) => id).handler(({ data }) => toggleFavorite(data))
export const addToCartFn = createServerFn({ method: 'POST' }).validator((id: number) => id).handler(({ data }) => addToCart(data))
export const checkoutCartFn = createServerFn({ method: 'POST' }).handler(() => checkoutCart())
