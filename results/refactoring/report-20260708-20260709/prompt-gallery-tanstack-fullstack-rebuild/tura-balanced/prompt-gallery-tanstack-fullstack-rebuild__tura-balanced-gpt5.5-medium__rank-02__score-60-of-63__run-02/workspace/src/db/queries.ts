import type Database from 'better-sqlite3'
import { getDb } from './client'
import { USER_ID } from './seed'

export type SortKey = 'featured' | 'newest' | 'popular'
export type CatalogFilters = {
  model?: string
  category?: string
  sort?: SortKey
  q?: string
  favoritesOnly?: boolean
  freeOnly?: boolean
  userId?: string
}

export type PromptCard = {
  id: number
  title: string
  model: string
  category: string
  priceCents: number
  sold: number
  rating: number
  creator: string
  creatorId: string
  aspectRatio: string
  description: string
  featured: number
  createdAt: string
  isFavorite: number
  rankScore: number
}

export function imageUrl(id: number, aspectRatio: string) {
  const [w, h] = aspectRatio.split('/').map(Number)
  const width = 640
  const height = Math.round((width * h) / w)
  return `https://picsum.photos/seed/pp${id}/${width}/${height}`
}

function baseParams(filters: CatalogFilters) {
  return {
    userId: filters.userId ?? USER_ID,
    model: filters.model && filters.model !== 'all' ? filters.model : null,
    category: filters.category && filters.category !== 'all' ? filters.category.toLowerCase() : null,
    q: filters.q ? `%${filters.q.toLowerCase()}%` : null,
    favoritesOnly: filters.favoritesOnly ? 1 : 0,
    freeOnly: filters.freeOnly ? 1 : 0,
  }
}

function orderSql(sort: SortKey = 'featured') {
  if (sort === 'newest') return 'p.created_at DESC, p.id DESC'
  if (sort === 'popular') return 'p.rating DESC, p.sold DESC, p.id DESC'
  return 'p.featured DESC, ((p.rating * 120) + (p.sold / 20.0) + (p.featured * 250) - (p.price_cents / 100.0)) DESC, p.sold DESC, p.id DESC'
}

export function listPrompts(filters: CatalogFilters = {}, db = getDb()) {
  const rows = db
    .prepare(
      `
      SELECT
        p.id, p.title, p.model, c.label AS category, p.price_cents AS priceCents,
        p.sold, p.rating, cr.name AS creator, cr.id AS creatorId,
        p.aspect_ratio AS aspectRatio, p.description, p.featured, p.created_at AS createdAt,
        CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS isFavorite,
        ROUND((p.rating * 120) + (p.sold / 20.0) + (p.featured * 250) - (p.price_cents / 100.0), 2) AS rankScore
      FROM prompts p
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = @userId
      WHERE (@model IS NULL OR p.model = @model)
        AND (@category IS NULL OR p.category_id = @category)
        AND (@q IS NULL OR lower(p.title || ' ' || p.model || ' ' || c.label || ' ' || p.description) LIKE @q)
        AND (@favoritesOnly = 0 OR f.prompt_id IS NOT NULL)
        AND (@freeOnly = 0 OR p.price_cents = 0)
      ORDER BY ${orderSql(filters.sort)}
      `,
    )
    .all(baseParams(filters)) as PromptCard[]

  return rows.map((row) => ({ ...row, imageUrl: imageUrl(row.id, row.aspectRatio) }))
}

export function getPrompt(id: number, userId = USER_ID, db = getDb()) {
  return db
    .prepare(
      `
      SELECT p.id, p.title, p.model, c.label AS category, p.price_cents AS priceCents,
        p.sold, p.rating, cr.name AS creator, cr.id AS creatorId, p.aspect_ratio AS aspectRatio,
        p.description, p.featured, p.created_at AS createdAt,
        CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS isFavorite,
        ROUND((p.rating * 120) + (p.sold / 20.0) + (p.featured * 250) - (p.price_cents / 100.0), 2) AS rankScore
      FROM prompts p
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
      WHERE p.id = ?
      `,
    )
    .get(userId, id) as (PromptCard & { imageUrl?: string }) | undefined
}

export function getCategories(db = getDb()) {
  return db.prepare('SELECT label, id FROM categories ORDER BY rowid').all() as { id: string; label: string }[]
}

export function getFilterCounts(userId = USER_ID, db = getDb()) {
  const counts = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN featured = 1 THEN 1 ELSE 0 END) AS featured,
        SUM(CASE WHEN price_cents = 0 THEN 1 ELSE 0 END) AS free,
        (SELECT COUNT(*) FROM favorites WHERE user_id = ?) AS favorites,
        (SELECT COUNT(*) FROM cart_items WHERE user_id = ?) AS cart
      FROM prompts
      `,
    )
    .get(userId, userId) as { total: number; featured: number; free: number; favorites: number; cart: number }
  const models = db.prepare('SELECT model, COUNT(*) AS count FROM prompts GROUP BY model ORDER BY model').all() as { model: string; count: number }[]
  return { ...counts, models }
}

export function toggleFavorite(promptId: number, userId = USER_ID, db = getDb()) {
  const exists = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND prompt_id = ?').get(userId, promptId)
  if (exists) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?').run(userId, promptId)
    return { isFavorite: false }
  }
  db.prepare('INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)').run(userId, promptId)
  return { isFavorite: true }
}

export function addToCart(promptId: number, userId = USER_ID, db = getDb()) {
  db.prepare(
    `
    INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (?, ?, 1)
    ON CONFLICT(user_id, prompt_id) DO UPDATE SET quantity = quantity + 1
    `,
  ).run(userId, promptId)
  return getCart(userId, db)
}

export function removeFromCart(promptId: number, userId = USER_ID, db = getDb()) {
  db.prepare('DELETE FROM cart_items WHERE user_id = ? AND prompt_id = ?').run(userId, promptId)
  return getCart(userId, db)
}

export function getCart(userId = USER_ID, db = getDb()) {
  const items = db
    .prepare(
      `
      SELECT p.id, p.title, p.model, c.label AS category, p.price_cents AS priceCents,
        p.aspect_ratio AS aspectRatio, ci.quantity, cr.name AS creator,
        p.price_cents * ci.quantity AS lineTotalCents
      FROM cart_items ci
      JOIN prompts p ON p.id = ci.prompt_id
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      WHERE ci.user_id = ?
      ORDER BY ci.rowid
      `,
    )
    .all(userId) as Array<{ id: number; title: string; model: string; category: string; priceCents: number; aspectRatio: string; quantity: number; creator: string; lineTotalCents: number }>
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0)
  const feeCents = subtotalCents > 0 ? Math.round(subtotalCents * 0.08) : 0
  const totalCents = subtotalCents + feeCents
  return { items: items.map((item) => ({ ...item, imageUrl: imageUrl(item.id, item.aspectRatio) })), subtotalCents, feeCents, totalCents, count: items.reduce((sum, item) => sum + item.quantity, 0) }
}

export function checkout(userId = USER_ID, db = getDb()) {
  const cart = getCart(userId, db)
  if (cart.items.length === 0) return { ok: false, orderIds: [], cart }

  const tx = db.transaction(() => {
    const next = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM orders').get() as { id: number }
    const insert = db.prepare('INSERT INTO orders (id, user_id, prompt_id, quantity, total_cents, created_at) VALUES (?, ?, ?, ?, ?, date())')
    const orderIds: number[] = []
    cart.items.forEach((item, index) => {
      const id = next.id + index
      orderIds.push(id)
      insert.run(id, userId, item.id, item.quantity, item.lineTotalCents)
    })
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId)
    return orderIds
  })

  return { ok: true, orderIds: tx(), cart: getCart(userId, db) }
}

export function getAnalytics(db = getDb()) {
  const summary = db.prepare(
    `
    SELECT
      COUNT(*) AS orders,
      COALESCE(SUM(total_cents), 0) AS revenueCents,
      ROUND(COALESCE(AVG(NULLIF(total_cents, 0)), 0), 2) AS averageOrderCents,
      ROUND((COUNT(*) * 100.0) / NULLIF((SELECT SUM(sold) FROM prompts), 0), 4) AS conversionRate
    FROM orders
    `,
  ).get() as { orders: number; revenueCents: number; averageOrderCents: number; conversionRate: number }

  const creatorRevenue = db.prepare(
    `
    SELECT cr.name AS creator, COALESCE(SUM(o.total_cents), 0) AS revenueCents,
      ROUND(COALESCE(SUM(o.total_cents), 0) * 0.85, 0) AS creatorRevenueCents,
      COUNT(o.id) AS orders
    FROM creators cr
    LEFT JOIN prompts p ON p.creator_id = cr.id
    LEFT JOIN orders o ON o.prompt_id = p.id
    GROUP BY cr.id
    ORDER BY creatorRevenueCents DESC
    `,
  ).all() as Array<{ creator: string; revenueCents: number; creatorRevenueCents: number; orders: number }>

  const categoryRevenue = db.prepare(
    `
    SELECT c.label AS category, COALESCE(SUM(o.total_cents), 0) AS revenueCents, COUNT(o.id) AS orders
    FROM categories c
    LEFT JOIN prompts p ON p.category_id = c.id
    LEFT JOIN orders o ON o.prompt_id = p.id
    GROUP BY c.id
    ORDER BY revenueCents DESC, c.label ASC
    `,
  ).all() as Array<{ category: string; revenueCents: number; orders: number }>

  const dailySales = db.prepare(
    `
    SELECT created_at AS day, COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS revenueCents
    FROM orders
    GROUP BY created_at
    ORDER BY created_at ASC
    `,
  ).all() as Array<{ day: string; orders: number; revenueCents: number }>

  const averagePrice = db.prepare('SELECT ROUND(AVG(price_cents), 2) AS averagePriceCents FROM prompts WHERE price_cents > 0').get() as { averagePriceCents: number }

  return { summary: { ...summary, averagePriceCents: averagePrice.averagePriceCents }, creatorRevenue, categoryRevenue, dailySales }
}

export function resetForTests(db: Database.Database) {
  db.exec('DELETE FROM cart_items; DELETE FROM favorites; DELETE FROM orders; DELETE FROM prompts; DELETE FROM categories; DELETE FROM creators; DELETE FROM users;')
}
