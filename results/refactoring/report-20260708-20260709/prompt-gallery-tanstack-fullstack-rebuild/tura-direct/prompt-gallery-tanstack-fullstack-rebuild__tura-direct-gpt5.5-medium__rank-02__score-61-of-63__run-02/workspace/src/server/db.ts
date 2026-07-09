import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { categories, creators, demoUserId, prompts, seedOrderItems, seedOrders } from './seed'

export type Db = Database.Database
const dbPath = join(process.cwd(), 'data', 'powerprompt.sqlite3')
let shared: Db | undefined

export function getDb(path = dbPath) {
  if (path === dbPath && shared) return shared
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  migrate(db)
  seed(db)
  if (path === dbPath) shared = db
  return db
}

export function createMemoryDb() {
  const db = new Database(':memory:')
  migrate(db)
  seed(db)
  return db
}

function migrate(db: Db) {
  db.exec(`
    create table if not exists users (id text primary key, name text not null);
    create table if not exists creators (id text primary key, name text not null, handle text not null, specialty text not null, avatar text not null);
    create table if not exists categories (id text primary key, name text not null, color text not null);
    create table if not exists prompts (
      id text primary key, title text not null, slug text not null unique, model text not null,
      category_id text not null references categories(id), creator_id text not null references creators(id),
      price_cents integer not null check(price_cents >= 0), featured integer not null check(featured in (0,1)),
      image text not null, ratio text not null, description text not null, tags text not null,
      sales integer not null default 0, views integer not null default 0, rating real not null default 0, created_at text not null
    );
    create table if not exists favorites (user_id text not null, prompt_id text not null, primary key(user_id, prompt_id));
    create table if not exists cart_items (user_id text not null, prompt_id text not null, quantity integer not null default 1, primary key(user_id, prompt_id));
    create table if not exists orders (id text primary key, user_id text not null, subtotal_cents integer not null, fee_cents integer not null, total_cents integer not null, status text not null, created_at text not null);
    create table if not exists order_items (order_id text not null, prompt_id text not null, price_cents integer not null);
  `)
}

function seed(db: Db) {
  db.prepare('insert or ignore into users (id, name) values (?, ?)').run(demoUserId, 'Demo buyer')
  const creatorStmt = db.prepare('insert or ignore into creators values (@id, @name, @handle, @specialty, @avatar)')
  creators.forEach((creator) => creatorStmt.run(creator))
  const catStmt = db.prepare('insert or ignore into categories values (@id, @name, @color)')
  categories.forEach((category) => catStmt.run(category))
  const promptStmt = db.prepare(`insert or ignore into prompts values (
    @id, @title, @slug, @model, @categoryId, @creatorId, @priceCents, @featured, @image, @ratio, @description, @tags, @sales, @views, @rating, @createdAt
  )`)
  prompts.forEach((prompt) => promptStmt.run(prompt))
  db.prepare('insert or ignore into favorites values (?, ?)').run(demoUserId, 'p-001')
  db.prepare('insert or ignore into favorites values (?, ?)').run(demoUserId, 'p-007')
  db.prepare('insert or ignore into cart_items values (?, ?, ?)').run(demoUserId, 'p-002', 1)
  db.prepare('insert or ignore into cart_items values (?, ?, ?)').run(demoUserId, 'p-004', 1)
  const orderStmt = db.prepare('insert or ignore into orders values (?, ?, ?, ?, ?, ?, ?)')
  seedOrders.forEach((order) => orderStmt.run(...order))
  const itemStmt = db.prepare('insert or ignore into order_items values (?, ?, ?)')
  seedOrderItems.forEach((item) => itemStmt.run(...item))
}
