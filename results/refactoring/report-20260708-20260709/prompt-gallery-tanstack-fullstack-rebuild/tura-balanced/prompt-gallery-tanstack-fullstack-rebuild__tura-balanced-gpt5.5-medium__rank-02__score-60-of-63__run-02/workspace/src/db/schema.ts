import type Database from 'better-sqlite3'
import { categories, creators, initialCart, initialFavorites, orders, prompts, USER_ID } from './seed'

export function migrate(db: Database.Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      tier TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id),
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      sold INTEGER NOT NULL,
      rating REAL NOT NULL,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      aspect_ratio TEXT NOT NULL,
      description TEXT NOT NULL,
      featured INTEGER NOT NULL CHECK (featured IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
}

export function seed(db: Database.Database) {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  if (userCount.count > 0) return

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(USER_ID, 'Demo Buyer')
    db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('user_creator', 'Creator Buyer')
    db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('user_research', 'Research Buyer')

    const insertCreator = db.prepare('INSERT INTO creators (id, name, handle, tier) VALUES (?, ?, ?, ?)')
    creators.forEach((creator) => insertCreator.run(creator.id, creator.name, creator.handle, creator.tier))

    const insertCategory = db.prepare('INSERT INTO categories (id, label) VALUES (?, ?)')
    categories.forEach((label) => insertCategory.run(label.toLowerCase(), label))

    const insertPrompt = db.prepare(`
      INSERT INTO prompts (id, title, model, category_id, price_cents, sold, rating, creator_id, aspect_ratio, description, featured, created_at)
      VALUES (@id, @title, @model, @categoryId, @priceCents, @sold, @rating, @creator, @ar, @desc, @featured, @created)
    `)
    prompts.forEach((prompt) => insertPrompt.run({ ...prompt, categoryId: prompt.category.toLowerCase(), priceCents: prompt.price * 100 }))

    const insertFavorite = db.prepare('INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)')
    initialFavorites.forEach((id) => insertFavorite.run(USER_ID, id))

    const insertCart = db.prepare('INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (?, ?, 1)')
    initialCart.forEach((id) => insertCart.run(USER_ID, id))

    const insertOrder = db.prepare('INSERT INTO orders (id, user_id, prompt_id, quantity, total_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    orders.forEach((order) => insertOrder.run(order.id, order.user, order.promptId, order.qty, order.total * 100, order.day))
  })

  tx()
}
