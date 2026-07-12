import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { categories, creators, orderSeeds, prompts, seedCart, seedFavorites, users } from './seed'

const dataDir = path.join(process.cwd(), 'data')
const dbPath = path.join(dataDir, 'powerprompt.sqlite')
const userId = 1

let SQL: SqlJsStatic | undefined
let db: Database | undefined

export type CatalogFilters = {
  model?: string
  category?: string
  sort?: 'featured' | 'newest' | 'popular'
  search?: string
  favoritesOnly?: boolean
  freeOnly?: boolean
}

async function loadSql() {
  SQL ||= await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  })
  return SQL
}

function rows<T>(database: Database, sql: string, params: Record<string, unknown> = {}) {
  const stmt = database.prepare(sql)
  stmt.bind(params)
  const out: T[] = []
  while (stmt.step()) out.push(stmt.getAsObject() as T)
  stmt.free()
  return out
}

function one<T>(database: Database, sql: string, params: Record<string, unknown> = {}) {
  return rows<T>(database, sql, params)[0]
}

function exec(database: Database, sql: string, params: unknown[] = []) {
  const stmt = database.prepare(sql)
  stmt.run(params)
  stmt.free()
}

function save(database: Database) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(dbPath, Buffer.from(database.export()))
}

function createSchema(database: Database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS creators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      handle TEXT NOT NULL,
      avatar TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      creator_id INTEGER NOT NULL REFERENCES creators(id),
      price INTEGER NOT NULL,
      sold INTEGER NOT NULL,
      rating REAL NOT NULL,
      aspect TEXT NOT NULL,
      description TEXT NOT NULL,
      image_seed TEXT NOT NULL,
      featured INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL REFERENCES users(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id INTEGER NOT NULL REFERENCES users(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      subtotal INTEGER NOT NULL,
      platform_fee INTEGER NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      price INTEGER NOT NULL,
      creator_revenue REAL NOT NULL
    );
  `)
}

function seed(database: Database) {
  const existing = one<{ total: number }>(database, 'SELECT COUNT(*) AS total FROM prompts')
  if (existing?.total) return

  categories.forEach((name) => exec(database, 'INSERT INTO categories (name) VALUES (?)', [name]))
  creators.forEach((creator) => exec(database, 'INSERT INTO creators (name, handle, avatar) VALUES (?, ?, ?)', [creator.name, creator.handle, creator.avatar]))
  users.forEach((user) => exec(database, 'INSERT INTO users (id, name, email) VALUES (?, ?, ?)', [user.id, user.name, user.email]))

  prompts.forEach((prompt) => {
    exec(
      database,
      `INSERT INTO prompts
        (id, title, model, category_id, creator_id, price, sold, rating, aspect, description, image_seed, featured, created_at)
       VALUES (?, ?, ?, (SELECT id FROM categories WHERE name = ?), (SELECT id FROM creators WHERE name = ?), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prompt.id,
        prompt.title,
        prompt.model,
        prompt.category,
        prompt.creator,
        prompt.price,
        prompt.sold,
        prompt.rating,
        prompt.aspect,
        prompt.desc,
        `pp${prompt.id}`,
        prompt.featured,
        prompt.date,
      ],
    )
  })

  seedFavorites.forEach((promptId) => exec(database, 'INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)', [userId, promptId]))
  seedCart.forEach((promptId) => exec(database, 'INSERT INTO cart_items (user_id, prompt_id) VALUES (?, ?)', [userId, promptId]))

  orderSeeds.forEach((order) => {
    const subtotal = order.promptIds.reduce((sum, id) => sum + prompts.find((prompt) => prompt.id === id)!.price, 0)
    const fee = Math.round(subtotal * 0.08)
    exec(database, 'INSERT INTO orders (user_id, subtotal, platform_fee, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      order.userId,
      subtotal,
      fee,
      subtotal + fee,
      order.status,
      order.createdAt,
    ])
    const orderId = one<{ id: number }>(database, 'SELECT last_insert_rowid() AS id').id
    order.promptIds.forEach((promptId) => {
      const price = prompts.find((prompt) => prompt.id === promptId)!.price
      exec(database, 'INSERT INTO order_items (order_id, prompt_id, price, creator_revenue) VALUES (?, ?, ?, ?)', [
        orderId,
        promptId,
        price,
        Math.round(price * 0.85 * 100) / 100,
      ])
    })
  })
}

export async function getDb() {
  if (db) return db
  const SQLModule = await loadSql()
  fs.mkdirSync(dataDir, { recursive: true })
  db = fs.existsSync(dbPath) ? new SQLModule.Database(fs.readFileSync(dbPath)) : new SQLModule.Database()
  createSchema(db)
  seed(db)
  save(db)
  return db
}

export async function resetDbForTests() {
  db?.close()
  db = undefined
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  return getDb()
}

const promptSelect = `
  SELECT p.id, p.title, p.model, c.name AS category, cr.name AS creator, cr.handle AS creatorHandle,
    p.price, p.sold, p.rating, p.aspect, p.description, p.image_seed AS imageSeed,
    p.featured, p.created_at AS createdAt,
    CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS favorite,
    CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END AS inCart,
    ROUND((p.rating * 1000) + (p.sold * 0.18) + (p.featured * 650) + CASE WHEN p.price = 0 THEN 200 ELSE 0 END, 2) AS rankScore
  FROM prompts p
  JOIN categories c ON c.id = p.category_id
  JOIN creators cr ON cr.id = p.creator_id
  LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = $userId
  LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = $userId
`

export async function getCatalog(filters: CatalogFilters = {}) {
  const database = await getDb()
  const where = ['1 = 1']
  const params: Record<string, unknown> = { $userId: userId }
  if (filters.model && filters.model !== 'all') {
    where.push('p.model = $model')
    params.$model = filters.model
  }
  if (filters.category && filters.category !== 'all') {
    where.push('c.name = $category')
    params.$category = filters.category
  }
  if (filters.search) {
    where.push('(LOWER(p.title || " " || p.model || " " || c.name || " " || p.description) LIKE $search)')
    params.$search = `%${filters.search.toLowerCase()}%`
  }
  if (filters.favoritesOnly) where.push('f.prompt_id IS NOT NULL')
  if (filters.freeOnly) where.push('p.price = 0')

  const order =
    filters.sort === 'newest'
      ? 'datetime(p.created_at) DESC, p.id DESC'
      : filters.sort === 'popular'
        ? 'p.rating DESC, p.sold DESC'
        : 'rankScore DESC, p.sold DESC'

  return rows(database, `${promptSelect} WHERE ${where.join(' AND ')} ORDER BY ${order}`, params)
}

export async function getPrompt(id: number) {
  const database = await getDb()
  return one(database, `${promptSelect} WHERE p.id = $id`, { $id: id, $userId: userId })
}

export async function getShellData() {
  const database = await getDb()
  return {
    categories: rows<{ name: string; promptCount: number }>(
      database,
      `SELECT c.name, COUNT(p.id) AS promptCount FROM categories c LEFT JOIN prompts p ON p.category_id = c.id GROUP BY c.id ORDER BY c.id`,
    ),
    models: rows<{ model: string; promptCount: number }>(database, 'SELECT model, COUNT(*) AS promptCount FROM prompts GROUP BY model ORDER BY model'),
    counts: one<{ total: number; free: number; paid: number; favorites: number; cart: number }>(
      database,
      `SELECT
        (SELECT COUNT(*) FROM prompts) AS total,
        (SELECT COUNT(*) FROM prompts WHERE price = 0) AS free,
        (SELECT COUNT(*) FROM prompts WHERE price > 0) AS paid,
        (SELECT COUNT(*) FROM favorites WHERE user_id = $userId) AS favorites,
        (SELECT COUNT(*) FROM cart_items WHERE user_id = $userId) AS cart`,
      { $userId: userId },
    ),
  }
}

export async function toggleFavorite(promptId: number) {
  const database = await getDb()
  const existing = one<{ prompt_id: number }>(database, 'SELECT prompt_id FROM favorites WHERE user_id = $userId AND prompt_id = $promptId', {
    $userId: userId,
    $promptId: promptId,
  })
  if (existing) {
    exec(database, 'DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?', [userId, promptId])
  } else {
    exec(database, 'INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)', [userId, promptId])
  }
  save(database)
  return { favorite: !existing }
}

export async function addToCart(promptId: number) {
  const database = await getDb()
  exec(database, 'INSERT OR IGNORE INTO cart_items (user_id, prompt_id) VALUES (?, ?)', [userId, promptId])
  save(database)
  return getCart()
}

export async function removeFromCart(promptId: number) {
  const database = await getDb()
  exec(database, 'DELETE FROM cart_items WHERE user_id = ? AND prompt_id = ?', [userId, promptId])
  save(database)
  return getCart()
}

export async function getCart() {
  const database = await getDb()
  const items = rows(
    database,
    `${promptSelect} WHERE ci.user_id = $userId ORDER BY ci.created_at DESC`,
    { $userId: userId },
  )
  const totals = one<{ subtotal: number; platformFee: number; total: number; itemCount: number }>(
    database,
    `SELECT
      COALESCE(SUM(p.price), 0) AS subtotal,
      ROUND(COALESCE(SUM(p.price), 0) * 0.08) AS platformFee,
      COALESCE(SUM(p.price), 0) + ROUND(COALESCE(SUM(p.price), 0) * 0.08) AS total,
      COUNT(*) AS itemCount
    FROM cart_items ci
    JOIN prompts p ON p.id = ci.prompt_id
    WHERE ci.user_id = $userId`,
    { $userId: userId },
  )
  return { items, totals }
}

export async function checkout() {
  const database = await getDb()
  const cart = await getCart()
  if (!cart.items.length) return { ok: false, orderId: null, cart }
  exec(database, 'INSERT INTO orders (user_id, subtotal, platform_fee, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    userId,
    cart.totals.subtotal,
    cart.totals.platformFee,
    cart.totals.total,
    'paid',
    new Date().toISOString(),
  ])
  const orderId = one<{ id: number }>(database, 'SELECT last_insert_rowid() AS id').id
  cart.items.forEach((item: any) => {
    exec(database, 'INSERT INTO order_items (order_id, prompt_id, price, creator_revenue) VALUES (?, ?, ?, ?)', [
      orderId,
      item.id,
      item.price,
      Math.round(item.price * 0.85 * 100) / 100,
    ])
  })
  exec(database, 'DELETE FROM cart_items WHERE user_id = ?', [userId])
  save(database)
  return { ok: true, orderId, cart: await getCart() }
}

export async function getAnalytics() {
  const database = await getDb()
  return {
    summary: one<{ revenue: number; orders: number; averageOrderValue: number; conversionRate: number; averagePrice: number }>(
      database,
      `SELECT
        COALESCE(SUM(o.total), 0) AS revenue,
        COUNT(DISTINCT o.id) AS orders,
        ROUND(COALESCE(AVG(o.total), 0), 2) AS averageOrderValue,
        ROUND(COUNT(DISTINCT o.id) * 1.0 / (SELECT COUNT(*) FROM prompts), 3) AS conversionRate,
        ROUND((SELECT AVG(price) FROM prompts WHERE price > 0), 2) AS averagePrice
       FROM orders o
       WHERE o.status = 'paid'`,
    ),
    creators: rows(
      database,
      `SELECT cr.name, cr.handle, ROUND(COALESCE(SUM(oi.creator_revenue), 0), 2) AS creatorRevenue,
        COUNT(oi.id) AS sales, ROUND(AVG(p.rating), 2) AS averageRating
       FROM creators cr
       JOIN prompts p ON p.creator_id = cr.id
       LEFT JOIN order_items oi ON oi.prompt_id = p.id
       GROUP BY cr.id
       ORDER BY creatorRevenue DESC, sales DESC
       LIMIT 8`,
    ),
    categories: rows(
      database,
      `SELECT c.name, ROUND(COALESCE(SUM(oi.price), 0), 2) AS categoryRevenue, COUNT(oi.id) AS sales
       FROM categories c
       JOIN prompts p ON p.category_id = c.id
       LEFT JOIN order_items oi ON oi.prompt_id = p.id
       GROUP BY c.id
       ORDER BY categoryRevenue DESC`,
    ),
    daily: rows(
      database,
      `SELECT date(created_at) AS day, SUM(total) AS revenue, COUNT(*) AS orders
       FROM orders
       WHERE status = 'paid'
       GROUP BY date(created_at)
       ORDER BY day ASC`,
    ),
  }
}
