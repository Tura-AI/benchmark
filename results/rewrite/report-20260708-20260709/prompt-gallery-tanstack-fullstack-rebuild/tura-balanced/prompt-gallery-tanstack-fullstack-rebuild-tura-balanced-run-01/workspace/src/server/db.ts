import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database } from 'sql.js'

import { cart, categories, creators, favorites, orderItems, orderRows, prompts, userId } from '../data/seed'
import { schemaSql } from './schema'

const dataDir = path.resolve(process.cwd(), 'data')
const dbPath = path.join(dataDir, 'powerprompt.sqlite3')

let dbPromise: Promise<Database> | undefined

function run(db: Database, sql: string, params: unknown[] = []) {
  db.run(sql, params as never[])
}

function first<T>(db: Database, sql: string, params: unknown[] = []): T | null {
  const rows = db.exec(sql, params as never[])
  if (!rows[0] || rows[0].values.length === 0) return null
  return Object.fromEntries(rows[0].columns.map((column, index) => [column, rows[0].values[0][index]])) as T
}

function all<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const rows = db.exec(sql, params as never[])
  if (!rows[0]) return []
  return rows[0].values.map((row) => Object.fromEntries(rows[0].columns.map((column, index) => [column, row[index]])) as T)
}

function persist(db: Database) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
}

async function openDatabase() {
  const SQL = await initSqlJs()
  const existing = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined
  const db = existing ? new SQL.Database(existing) : new SQL.Database()
  db.run(schemaSql)
  const count = first<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM prompts')?.count ?? 0
  if (count === 0) {
    seed(db)
    persist(db)
  }
  return db
}

export function getDb() {
  dbPromise ??= openDatabase()
  return dbPromise
}

export function resetDbForTests() {
  dbPromise = undefined
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
}

function seed(db: Database) {
  run(db, 'INSERT INTO users (id, email) VALUES (?, ?)', [userId, 'demo@powerprompt.local'])
  for (const creator of creators) {
    run(db, 'INSERT INTO creators (id, name, handle, payout_rate) VALUES (?, ?, ?, ?)', [creator.id, creator.name, creator.handle, creator.payoutRate])
  }
  for (const name of categories) {
    run(db, 'INSERT INTO categories (id, name) VALUES (?, ?)', [name.toLowerCase(), name])
  }
  for (const prompt of prompts) {
    run(
      db,
      `INSERT INTO prompts (id, title, model, category, price, sold, rating, creator_id, aspect, featured, created_at, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prompt.id, prompt.title, prompt.model, prompt.category, prompt.price, prompt.sold, prompt.rating, prompt.creatorId, prompt.aspect, prompt.featured, prompt.createdAt, prompt.desc],
    )
  }
  for (const promptId of favorites) run(db, 'INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)', [userId, promptId])
  for (const promptId of cart) run(db, 'INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (?, ?, 1)', [userId, promptId])
  for (const order of orderRows) run(db, 'INSERT INTO orders (id, user_id, created_at, subtotal, fee, total) VALUES (?, ?, ?, ?, ?, ?)', [order.id, order.userId, order.createdAt, order.subtotal, order.fee, order.total])
  for (const item of orderItems) run(db, 'INSERT INTO order_items (order_id, prompt_id, quantity, price) VALUES (?, ?, ?, ?)', [item.orderId, item.promptId, item.quantity, item.price])
}

export const sql = { all, first, run, persist, userId }
