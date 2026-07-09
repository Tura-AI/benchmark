import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { categories, creators, orderSeed, prompts } from './seed'

export type PromptRow = {
  id: number
  title: string
  model: string
  category: string
  price: number
  sold: number
  rating: number
  creator: string
  creatorId: number
  aspectRatio: string
  description: string
  featured: number
  createdAt: string
  imageUrl: string
  rankScore: number
  isFavorite: number
  inCart: number
}

const dbPath = path.join(process.cwd(), 'data', 'powerprompt.sqlite')
let db: DatabaseSync | undefined

export function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    migrate(db)
    seed(db)
  }
  return db
}

export function resetDbForTests() {
  db?.close()
  db = undefined
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
  return getDb()
}

function migrate(conn: DatabaseSync) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creators (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      commission_rate REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      price REAL NOT NULL,
      sold INTEGER NOT NULL,
      rating REAL NOT NULL,
      creator_id INTEGER NOT NULL REFERENCES creators(id),
      aspect_ratio TEXT NOT NULL,
      description TEXT NOT NULL,
      featured INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      prompt_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id INTEGER NOT NULL,
      prompt_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ordered_at TEXT NOT NULL,
      subtotal REAL NOT NULL,
      fee REAL NOT NULL,
      total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id INTEGER REFERENCES prompts(id),
      visited_at TEXT NOT NULL
    );
  `)
}

function seed(conn: DatabaseSync) {
  const count = conn.prepare('SELECT COUNT(*) as c FROM prompts').get() as { c: number }
  if (count.c > 0) return

  const insert = () => {
    conn.exec('BEGIN')
    try {
    conn.prepare('INSERT INTO users (id, name) VALUES (1, ?)').run('Demo buyer')
    const catStmt = conn.prepare('INSERT INTO categories (id, name) VALUES (?, ?)')
    categories.forEach((name, index) => catStmt.run(index + 1, name))
    const creatorStmt = conn.prepare('INSERT INTO creators (id, name, handle, commission_rate) VALUES (?, ?, ?, ?)')
    creators.forEach((c) => creatorStmt.run(c.id, c.name, c.handle, c.commissionRate))
    const promptStmt = conn.prepare(`
      INSERT INTO prompts
      (id, title, model, category_id, price, sold, rating, creator_id, aspect_ratio, description, featured, created_at)
      VALUES (?, ?, ?, (SELECT id FROM categories WHERE name = ?), ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    prompts.forEach((p) => promptStmt.run(...p))
    conn.prepare('INSERT INTO favorites (user_id, prompt_id) VALUES (1, 31), (1, 211), (1, 301)').run()
    conn.prepare('INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (1, 207, 1), (1, 142, 1)').run()

    const orderStmt = conn.prepare('INSERT INTO orders (user_id, ordered_at, subtotal, fee, total) VALUES (1, ?, ?, ?, ?)')
    const itemStmt = conn.prepare('INSERT INTO order_items (order_id, prompt_id, quantity, unit_price) VALUES (?, ?, ?, ?)')
    orderSeed.forEach(([day, promptId, price, quantity]) => {
      const subtotal = Number(price) * Number(quantity)
      const fee = Math.round(subtotal * 0.06 * 100) / 100
      const info = orderStmt.run(day, subtotal, fee, subtotal + fee)
      itemStmt.run(info.lastInsertRowid, promptId, quantity, price)
    })
    const visitStmt = conn.prepare('INSERT INTO visits (prompt_id, visited_at) VALUES (?, ?)')
    prompts.forEach((p, index) => {
      const repeat = 25 + (Number(p[5]) % 50)
      for (let i = 0; i < repeat; i++) visitStmt.run(p[0], `2026-07-0${(index % 8) + 1}`)
    })
      conn.exec('COMMIT')
    } catch (error) {
      conn.exec('ROLLBACK')
      throw error
    }
  }
  insert()
}

function imageUrl(id: number, aspectRatio: string) {
  const [w, h] = aspectRatio.split('/').map(Number)
  const width = 640
  const height = Math.round((width * h) / w)
  return `https://picsum.photos/seed/powerprompt-${id}/${width}/${height}`
}

export function listCategories() {
  return getDb()
    .prepare(
      `SELECT c.name, COUNT(p.id) count
       FROM categories c LEFT JOIN prompts p ON p.category_id = c.id
       GROUP BY c.id ORDER BY c.id`,
    )
    .all() as Array<{ name: string; count: number }>
}

export function listPrompts(input: {
  model?: string
  category?: string
  sort?: string
  search?: string
  favoritesOnly?: boolean
  freeOnly?: boolean
  userId?: number
} = {}) {
  const userId = input.userId ?? 1
  const model = input.model ?? 'all'
  const category = input.category ?? 'all'
  const search = `%${(input.search ?? '').toLowerCase()}%`
  const favOnly = input.favoritesOnly ? 1 : 0
  const freeOnly = input.freeOnly ? 1 : 0
  const sortSql =
    input.sort === 'newest'
      ? 'p.created_at DESC, p.id DESC'
      : input.sort === 'popular'
        ? 'p.rating DESC, p.sold DESC'
        : 'rankScore DESC, p.featured DESC'
  const rows = getDb()
    .prepare(
      `
      SELECT p.id, p.title, p.model, c.name category, p.price, p.sold, p.rating,
        cr.name creator, cr.id creatorId, p.aspect_ratio aspectRatio, p.description,
        p.featured, p.created_at createdAt,
        ROUND((p.rating * 20) + (p.sold / 120.0) + (p.featured * 35) - (p.price * 0.28), 2) rankScore,
        CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END isFavorite,
        CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END inCart
      FROM prompts p
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
      LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = ?
      WHERE (? = 'all' OR p.model = ?)
        AND (? = 'all' OR c.name = ?)
        AND (? = 0 OR p.price = 0)
        AND (? = 0 OR f.prompt_id IS NOT NULL)
        AND (LOWER(p.title || ' ' || p.model || ' ' || c.name || ' ' || p.description || ' ' || cr.name) LIKE ?)
      ORDER BY ${sortSql}
    `,
    )
    .all(userId, userId, model, model, category, category, freeOnly, favOnly, search) as PromptRow[]
  return rows.map((row) => ({ ...row, imageUrl: imageUrl(row.id, row.aspectRatio) }))
}

export function getPrompt(id: number, userId = 1) {
  return listPrompts({ userId }).find((prompt) => prompt.id === id) ?? null
}

export function toggleFavorite(promptId: number, userId = 1) {
  const conn = getDb()
  const found = conn.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND prompt_id = ?').get(userId, promptId)
  if (found) {
    conn.prepare('DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?').run(userId, promptId)
    return { favorited: false }
  }
  conn.prepare('INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)').run(userId, promptId)
  return { favorited: true }
}

export function addCartItem(promptId: number, userId = 1) {
  getDb()
    .prepare(
      `INSERT INTO cart_items (user_id, prompt_id, quantity)
       VALUES (?, ?, 1)
       ON CONFLICT(user_id, prompt_id) DO UPDATE SET quantity = quantity + 1`,
    )
    .run(userId, promptId)
  return getCart(userId)
}

export function removeCartItem(promptId: number, userId = 1) {
  getDb().prepare('DELETE FROM cart_items WHERE user_id = ? AND prompt_id = ?').run(userId, promptId)
  return getCart(userId)
}

export function getCart(userId = 1) {
  const items = getDb()
    .prepare(
      `
      SELECT p.id, p.title, p.model, c.name category, p.price, ci.quantity,
        cr.name creator, p.aspect_ratio aspectRatio,
        ROUND(p.price * ci.quantity, 2) lineTotal
      FROM cart_items ci
      JOIN prompts p ON p.id = ci.prompt_id
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      WHERE ci.user_id = ?
      ORDER BY ci.created_at DESC
    `,
    )
    .all(userId) as Array<PromptRow & { quantity: number; lineTotal: number }>
  const totalRow = getDb()
    .prepare(
      `
      SELECT
        ROUND(COALESCE(SUM(p.price * ci.quantity), 0), 2) subtotal,
        ROUND(COALESCE(SUM(p.price * ci.quantity), 0) * 0.06, 2) fee,
        ROUND(COALESCE(SUM(p.price * ci.quantity), 0) * 1.06, 2) total,
        COALESCE(SUM(ci.quantity), 0) count
      FROM cart_items ci JOIN prompts p ON p.id = ci.prompt_id
      WHERE ci.user_id = ?
    `,
    )
    .get(userId) as { subtotal: number; fee: number; total: number; count: number }
  return {
    items: items.map((item) => ({ ...item, imageUrl: imageUrl(item.id, item.aspectRatio) })),
    totals: totalRow,
  }
}

export function checkout(userId = 1) {
  const cart = getCart(userId)
  if (cart.items.length === 0) return { ok: false, message: 'Cart is empty', orderId: null, cart }
  const conn = getDb()
  const tx = () => {
    conn.exec('BEGIN')
    try {
    const order = conn
      .prepare("INSERT INTO orders (user_id, ordered_at, subtotal, fee, total) VALUES (?, date('now'), ?, ?, ?)")
      .run(userId, cart.totals.subtotal, cart.totals.fee, cart.totals.total)
    const itemStmt = conn.prepare('INSERT INTO order_items (order_id, prompt_id, quantity, unit_price) VALUES (?, ?, ?, ?)')
    cart.items.forEach((item) => itemStmt.run(order.lastInsertRowid, item.id, item.quantity, item.price))
      conn.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId)
      conn.exec('COMMIT')
      return Number(order.lastInsertRowid)
    } catch (error) {
      conn.exec('ROLLBACK')
      throw error
    }
  }
  return { ok: true, message: 'Checkout complete', orderId: tx(), cart: getCart(userId) }
}

export function analytics() {
  const conn = getDb()
  const summary = conn
    .prepare(
      `
      SELECT
        COUNT(DISTINCT o.id) orders,
        ROUND(SUM(o.total), 2) grossRevenue,
        ROUND(AVG(o.total), 2) averageOrderValue,
        (SELECT COUNT(*) FROM visits) visits,
        ROUND(COUNT(DISTINCT o.id) * 100.0 / (SELECT COUNT(*) FROM visits), 2) conversionRate
      FROM orders o
    `,
    )
    .get() as { orders: number; grossRevenue: number; averageOrderValue: number; visits: number; conversionRate: number }
  const creators = conn
    .prepare(
      `
      SELECT cr.name, cr.handle,
        ROUND(SUM(oi.quantity * oi.unit_price), 2) gross,
        ROUND(SUM(oi.quantity * oi.unit_price * cr.commission_rate), 2) creatorRevenue,
        SUM(oi.quantity) units
      FROM order_items oi
      JOIN prompts p ON p.id = oi.prompt_id
      JOIN creators cr ON cr.id = p.creator_id
      GROUP BY cr.id
      ORDER BY creatorRevenue DESC
    `,
    )
    .all() as Array<{ name: string; handle: string; gross: number; creatorRevenue: number; units: number }>
  const categories = conn
    .prepare(
      `
      SELECT c.name, ROUND(SUM(oi.quantity * oi.unit_price), 2) revenue, SUM(oi.quantity) units
      FROM order_items oi
      JOIN prompts p ON p.id = oi.prompt_id
      JOIN categories c ON c.id = p.category_id
      GROUP BY c.id ORDER BY revenue DESC
    `,
    )
    .all() as Array<{ name: string; revenue: number; units: number }>
  const daily = conn
    .prepare(
      `
      SELECT ordered_at day, ROUND(SUM(total), 2) revenue, COUNT(*) orders
      FROM orders GROUP BY ordered_at ORDER BY ordered_at
    `,
    )
    .all() as Array<{ day: string; revenue: number; orders: number }>
  const modelMix = conn
    .prepare(
      `
      SELECT p.model, SUM(oi.quantity) units, ROUND(SUM(oi.quantity * oi.unit_price), 2) revenue
      FROM order_items oi JOIN prompts p ON p.id = oi.prompt_id
      GROUP BY p.model ORDER BY revenue DESC
    `,
    )
    .all() as Array<{ model: string; units: number; revenue: number }>
  return { summary, creators, categories, daily, modelMix }
}
