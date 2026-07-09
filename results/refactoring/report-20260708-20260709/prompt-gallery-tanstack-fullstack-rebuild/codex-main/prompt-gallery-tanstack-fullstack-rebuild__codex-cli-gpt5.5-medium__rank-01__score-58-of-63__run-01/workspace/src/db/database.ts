import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import {
  cart,
  categories,
  creators,
  favorites,
  orderItems,
  orders,
  prompts,
  userId,
} from './seed.ts'

const dbDir = path.join(process.cwd(), 'db')
const dbPath = path.join(dbDir, 'powerprompt.sqlite')

let dbPromise: Promise<Database> | undefined

export type PromptRow = {
  id: number
  title: string
  model: string
  category: string
  price: number
  sold: number
  rating: number
  creatorId: number
  creator: string
  aspect: string
  featured: number
  createdAt: string
  description: string
  rankScore: number
  isFavorite: number
  inCart: number
}

export type CatalogFilters = {
  model?: string
  category?: string
  sort?: 'featured' | 'newest' | 'popular'
  query?: string
  favoritesOnly?: boolean
  freeOnly?: boolean
}

async function createDb() {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), 'node_modules/sql.js/dist', file),
  })
  fs.mkdirSync(dbDir, { recursive: true })
  if (fs.existsSync(dbPath)) {
    return new SQL.Database(fs.readFileSync(dbPath))
  }
  const db = new SQL.Database()
  migrate(db)
  seed(db)
  persist(db)
  return db
}

export async function getDb(options?: { reset?: boolean }) {
  if (options?.reset) {
    dbPromise = undefined
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  }
  dbPromise ??= createDb()
  return dbPromise
}

export function persist(db: Database) {
  fs.mkdirSync(dbDir, { recursive: true })
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
}

function run(db: Database, sql: string, params: unknown[] = []) {
  db.run(sql, params)
}

function runMany(db: Database, sql: string) {
  sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .forEach((statement) => db.run(statement))
}

function migrate(db: Database) {
  runMany(
    db,
    `
    CREATE TABLE creators (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      commission_rate REAL NOT NULL
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE prompts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      sold INTEGER NOT NULL,
      rating REAL NOT NULL,
      creator_id INTEGER NOT NULL REFERENCES creators(id),
      aspect TEXT NOT NULL,
      featured INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      description TEXT NOT NULL
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE favorites (
      user_id INTEGER NOT NULL,
      prompt_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE cart_items (
      user_id INTEGER NOT NULL,
      prompt_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE order_items (
      order_id INTEGER NOT NULL,
      prompt_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
    CREATE INDEX idx_prompts_model ON prompts(model);
    CREATE INDEX idx_prompts_category ON prompts(category);
    CREATE INDEX idx_order_items_prompt ON order_items(prompt_id);
  `,
  )
}

function seed(db: Database) {
  creators.forEach((creator) =>
    run(db, 'INSERT INTO creators VALUES (?, ?, ?, ?)', [
      creator.id,
      creator.name,
      creator.handle,
      creator.commissionRate,
    ]),
  )
  categories.forEach((name) => run(db, 'INSERT INTO categories(name) VALUES (?)', [name]))
  run(db, 'INSERT INTO users VALUES (?, ?)', [userId, 'Demo buyer'])
  prompts.forEach((prompt) =>
    run(
      db,
      `INSERT INTO prompts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prompt.id,
        prompt.title,
        prompt.model,
        prompt.category,
        prompt.price,
        prompt.sold,
        prompt.rating,
        prompt.creatorId,
        prompt.aspect,
        prompt.featured,
        prompt.createdAt,
        prompt.description,
      ],
    ),
  )
  favorites.forEach((promptId) =>
    run(db, 'INSERT INTO favorites VALUES (?, ?)', [userId, promptId]),
  )
  cart.forEach((promptId) =>
    run(db, 'INSERT INTO cart_items VALUES (?, ?, 1)', [userId, promptId]),
  )
  orders.forEach((order) =>
    run(db, 'INSERT INTO orders VALUES (?, ?, ?, ?, ?)', [
      order.id,
      order.userId,
      order.total,
      order.status,
      order.createdAt,
    ]),
  )
  orderItems.forEach((item) =>
    run(db, 'INSERT INTO order_items VALUES (?, ?, ?, ?)', [
      item.orderId,
      item.promptId,
      item.quantity,
      item.unitPrice,
    ]),
  )
}

export function rows<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql, params)
  const result: T[] = []
  try {
    while (stmt.step()) result.push(stmt.getAsObject() as T)
  } finally {
    stmt.free()
  }
  return result
}

export function one<T>(db: Database, sql: string, params: unknown[] = []) {
  return rows<T>(db, sql, params)[0]
}

export function imageForPrompt(id: number, aspect: string) {
  const [w, h] = aspect.split('/').map(Number)
  const width = 640
  const height = Math.round((width * h) / w)
  return `https://picsum.photos/seed/powerprompt-${id}/${width}/${height}`
}

export async function listPrompts(filters: CatalogFilters = {}) {
  const db = await getDb()
  const conditions = ['1=1']
  const params: unknown[] = []
  if (filters.model && filters.model !== 'All') {
    conditions.push('p.model = ?')
    params.push(filters.model)
  }
  if (filters.category && filters.category !== 'All') {
    conditions.push('p.category = ?')
    params.push(filters.category)
  }
  if (filters.query) {
    conditions.push(
      '(lower(p.title || " " || p.description || " " || p.model || " " || p.category) LIKE ?)',
    )
    params.push(`%${filters.query.toLowerCase()}%`)
  }
  if (filters.favoritesOnly) conditions.push('f.prompt_id IS NOT NULL')
  if (filters.freeOnly) conditions.push('p.price = 0')

  const orderBy =
    filters.sort === 'newest'
      ? 'date(p.created_at) DESC, p.id DESC'
      : filters.sort === 'popular'
        ? 'p.rating DESC, p.sold DESC'
        : 'rankScore DESC, p.featured DESC'

  return rows<PromptRow>(
    db,
    `
    SELECT
      p.id, p.title, p.model, p.category, p.price, p.sold, p.rating,
      p.creator_id as creatorId, c.name as creator, p.aspect, p.featured,
      p.created_at as createdAt, p.description,
      round((p.rating * 18) + (p.sold / 120.0) + (p.featured * 16) - (p.price * 0.08), 2) as rankScore,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END as isFavorite,
      CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END as inCart
    FROM prompts p
    JOIN creators c ON c.id = p.creator_id
    LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
    LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = ?
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
  `,
    [userId, userId, ...params],
  ).map((prompt) => ({
    ...prompt,
    image: imageForPrompt(prompt.id, prompt.aspect),
  }))
}

export async function getPrompt(promptId: number) {
  const db = await getDb()
  const item = one<PromptRow>(
    db,
    `
    SELECT
      p.id, p.title, p.model, p.category, p.price, p.sold, p.rating,
      p.creator_id as creatorId, c.name as creator, p.aspect, p.featured,
      p.created_at as createdAt, p.description,
      round((p.rating * 18) + (p.sold / 120.0) + (p.featured * 16) - (p.price * 0.08), 2) as rankScore,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END as isFavorite,
      CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END as inCart
    FROM prompts p
    JOIN creators c ON c.id = p.creator_id
    LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
    LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = ?
    WHERE p.id = ?
  `,
    [userId, userId, promptId],
  )
  return item ? { ...item, image: imageForPrompt(item.id, item.aspect) } : null
}

export async function getFilters() {
  const db = await getDb()
  const models = rows<{ model: string; count: number }>(
    db,
    'SELECT model, count(*) as count FROM prompts GROUP BY model ORDER BY model',
  )
  const cats = rows<{ category: string; count: number }>(
    db,
    'SELECT category, count(*) as count FROM prompts GROUP BY category ORDER BY category',
  )
  const counts = one<{
    featured: number
    free: number
    paid: number
    favorites: number
    cart: number
  }>(
    db,
    `
    SELECT
      sum(featured) as featured,
      sum(CASE WHEN price = 0 THEN 1 ELSE 0 END) as free,
      sum(CASE WHEN price > 0 THEN 1 ELSE 0 END) as paid,
      (SELECT count(*) FROM favorites WHERE user_id = ?) as favorites,
      (SELECT count(*) FROM cart_items WHERE user_id = ?) as cart
    FROM prompts
  `,
    [userId, userId],
  )
  return { models, categories: cats, counts }
}

export async function toggleFavorite(promptId: number) {
  const db = await getDb()
  const current = one<{ count: number }>(
    db,
    'SELECT count(*) as count FROM favorites WHERE user_id = ? AND prompt_id = ?',
    [userId, promptId],
  )
  if (current?.count) {
    run(db, 'DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?', [userId, promptId])
  } else {
    run(db, 'INSERT INTO favorites VALUES (?, ?)', [userId, promptId])
  }
  persist(db)
  return { isFavorite: !current?.count }
}

export async function addToCart(promptId: number) {
  const db = await getDb()
  run(
    db,
    `INSERT INTO cart_items(user_id, prompt_id, quantity)
     VALUES (?, ?, 1)
     ON CONFLICT(user_id, prompt_id) DO UPDATE SET quantity = quantity + 1`,
    [userId, promptId],
  )
  persist(db)
  return getCart()
}

export async function removeFromCart(promptId: number) {
  const db = await getDb()
  run(db, 'DELETE FROM cart_items WHERE user_id = ? AND prompt_id = ?', [userId, promptId])
  persist(db)
  return getCart()
}

export async function getCart() {
  const db = await getDb()
  const items = rows<
    PromptRow & {
      quantity: number
      lineTotal: number
    }
  >(
    db,
    `
    SELECT
      p.id, p.title, p.model, p.category, p.price, p.sold, p.rating,
      p.creator_id as creatorId, c.name as creator, p.aspect, p.featured,
      p.created_at as createdAt, p.description, ci.quantity,
      round(ci.quantity * p.price, 2) as lineTotal,
      round((p.rating * 18) + (p.sold / 120.0) + (p.featured * 16) - (p.price * 0.08), 2) as rankScore,
      0 as isFavorite, 1 as inCart
    FROM cart_items ci
    JOIN prompts p ON p.id = ci.prompt_id
    JOIN creators c ON c.id = p.creator_id
    WHERE ci.user_id = ?
    ORDER BY ci.prompt_id DESC
  `,
    [userId],
  ).map((item) => ({ ...item, image: imageForPrompt(item.id, item.aspect) }))

  const totals = one<{
    subtotal: number
    platformFee: number
    total: number
    paidCount: number
    freeCount: number
  }>(
    db,
    `
    SELECT
      round(coalesce(sum(ci.quantity * p.price), 0), 2) as subtotal,
      round(coalesce(sum(ci.quantity * p.price), 0) * 0.065, 2) as platformFee,
      round(coalesce(sum(ci.quantity * p.price), 0) * 1.065, 2) as total,
      sum(CASE WHEN p.price > 0 THEN ci.quantity ELSE 0 END) as paidCount,
      sum(CASE WHEN p.price = 0 THEN ci.quantity ELSE 0 END) as freeCount
    FROM cart_items ci
    JOIN prompts p ON p.id = ci.prompt_id
    WHERE ci.user_id = ?
  `,
    [userId],
  )
  return {
    items,
    totals: {
      subtotal: totals?.subtotal ?? 0,
      platformFee: totals?.platformFee ?? 0,
      total: totals?.total ?? 0,
      paidCount: totals?.paidCount ?? 0,
      freeCount: totals?.freeCount ?? 0,
    },
  }
}

export async function checkout() {
  const db = await getDb()
  const cartState = await getCart()
  if (!cartState.items.length) return { ok: false, orderId: null, cart: cartState }
  const next = one<{ id: number }>(db, 'SELECT coalesce(max(id), 0) + 1 as id FROM orders')
  const orderId = next?.id ?? 1
  run(db, 'INSERT INTO orders VALUES (?, ?, ?, ?, date("now"))', [
    orderId,
    userId,
    cartState.totals.total,
    'paid',
  ])
  cartState.items.forEach((item) =>
    run(db, 'INSERT INTO order_items VALUES (?, ?, ?, ?)', [
      orderId,
      item.id,
      item.quantity,
      item.price,
    ]),
  )
  run(db, 'DELETE FROM cart_items WHERE user_id = ?', [userId])
  persist(db)
  return { ok: true, orderId, cart: await getCart() }
}

export async function getAnalytics() {
  const db = await getDb()
  const summary = one<{
    grossRevenue: number
    creatorRevenue: number
    orders: number
    visitors: number
    conversionRate: number
    averageOrderValue: number
    averagePrice: number
  }>(
    db,
    `
    WITH paid_orders AS (
      SELECT * FROM orders WHERE status = 'paid'
    ),
    revenue AS (
      SELECT
        sum(oi.quantity * oi.unit_price) as gross,
        sum(oi.quantity * oi.unit_price * c.commission_rate) as creator_revenue
      FROM order_items oi
      JOIN prompts p ON p.id = oi.prompt_id
      JOIN creators c ON c.id = p.creator_id
      JOIN paid_orders o ON o.id = oi.order_id
    )
    SELECT
      round(coalesce(revenue.gross, 0), 2) as grossRevenue,
      round(coalesce(revenue.creator_revenue, 0), 2) as creatorRevenue,
      (SELECT count(*) FROM paid_orders) as orders,
      1480 as visitors,
      round((SELECT count(*) FROM paid_orders) * 100.0 / 1480, 2) as conversionRate,
      round((SELECT coalesce(avg(total), 0) FROM paid_orders), 2) as averageOrderValue,
      round((SELECT avg(price) FROM prompts WHERE price > 0), 2) as averagePrice
    FROM revenue
  `,
  )
  const creators = rows<{
    creator: string
    sales: number
    grossRevenue: number
    creatorRevenue: number
  }>(
    db,
    `
    SELECT
      c.name as creator,
      coalesce(sum(oi.quantity), 0) as sales,
      round(coalesce(sum(oi.quantity * oi.unit_price), 0), 2) as grossRevenue,
      round(coalesce(sum(oi.quantity * oi.unit_price * c.commission_rate), 0), 2) as creatorRevenue
    FROM creators c
    LEFT JOIN prompts p ON p.creator_id = c.id
    LEFT JOIN order_items oi ON oi.prompt_id = p.id
    LEFT JOIN orders o ON o.id = oi.order_id AND o.status = 'paid'
    GROUP BY c.id
    ORDER BY creatorRevenue DESC
  `,
  )
  const categoryRevenue = rows<{
    category: string
    sales: number
    revenue: number
  }>(
    db,
    `
    SELECT
      p.category,
      sum(oi.quantity) as sales,
      round(sum(oi.quantity * oi.unit_price), 2) as revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.status = 'paid'
    JOIN prompts p ON p.id = oi.prompt_id
    GROUP BY p.category
    ORDER BY revenue DESC
  `,
  )
  const dailySales = rows<{
    day: string
    orders: number
    sales: number
    revenue: number
  }>(
    db,
    `
    SELECT
      o.created_at as day,
      count(DISTINCT o.id) as orders,
      sum(oi.quantity) as sales,
      round(sum(oi.quantity * oi.unit_price), 2) as revenue
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'paid'
    GROUP BY o.created_at
    ORDER BY o.created_at
  `,
  )
  return { summary, creators, categoryRevenue, dailySales }
}
