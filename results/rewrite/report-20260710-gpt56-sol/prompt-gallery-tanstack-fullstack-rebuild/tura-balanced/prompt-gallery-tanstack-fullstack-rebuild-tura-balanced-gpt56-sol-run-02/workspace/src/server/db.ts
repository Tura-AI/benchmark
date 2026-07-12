import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { CartSummary, CatalogInput, Prompt } from '../contracts/marketplace'
import { seedDatabase } from './seed'
import schemaSql from './schema.sql?raw'

const defaultPath = resolve(process.cwd(), process.env.POWERPROMPT_DB_PATH || 'data/powerprompt.db')
let singleton: DatabaseSync | undefined
export const DEMO_USER = 'demo-user'

export function createDatabase(path = defaultPath) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(schemaSql)
  const count = db.prepare('SELECT COUNT(*) AS n FROM prompts').get() as { n: number }
  if (!count.n) db.exec('BEGIN IMMEDIATE'), seedDatabase(db), db.exec('COMMIT')
  return db
}

export function getDatabase() { return singleton ??= createDatabase() }
const bool = (value: unknown) => Boolean(value)
const mapPrompt = (row: Record<string, unknown>): Prompt => ({
  id: String(row.id), title: String(row.title), model: String(row.model), category: String(row.category),
  description: String(row.description), priceCents: Number(row.priceCents), sold: Number(row.sold),
  rating: Number(row.rating), creatorId: String(row.creatorId), creatorName: String(row.creatorName),
  image: String(row.image), aspect: String(row.aspect), createdAt: String(row.createdAt),
  featured: bool(row.featured), favorite: bool(row.favorite), rankScore: Number(row.rankScore),
})

const promptColumns = `p.id,p.title,p.model,c.name category,p.description,p.price_cents priceCents,
  p.sold,p.rating,p.creator_id creatorId,cr.name creatorName,p.image,p.aspect,p.created_at createdAt,
  p.featured,CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END favorite,
  ROUND((p.rating * 20) + LOG10(p.sold + 1) * 12 + p.featured * 10, 2) rankScore`
const promptSelect = `SELECT ${promptColumns}
  FROM prompts p JOIN creators cr ON cr.id=p.creator_id JOIN categories c ON c.id=p.category_id
  LEFT JOIN favorites f ON f.prompt_id=p.id AND f.user_id=?`

export function listPrompts(db: DatabaseSync, input: CatalogInput, userId = DEMO_USER) {
  const where = [`(? = 'all' OR p.model = ?)`, `(? = 'all' OR c.name = ?)`,
    `(? = '' OR LOWER(p.title||' '||p.description||' '||c.name||' '||p.model) LIKE '%'||LOWER(?)||'%')`,
    `(? = 0 OR f.prompt_id IS NOT NULL)`, `(? = 0 OR p.price_cents = 0)`]
  const order = input.sort === 'newest' ? 'p.created_at DESC' : input.sort === 'popular' ? 'p.rating DESC,p.sold DESC' : 'rankScore DESC'
  const params = [userId,input.model,input.model,input.category,input.category,input.q,input.q,input.favorites?1:0,input.free?1:0]
  return (db.prepare(`${promptSelect} WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(...params) as Record<string,unknown>[]).map(mapPrompt)
}

export function catalog(db: DatabaseSync, input: CatalogInput) {
  const prompts = listPrompts(db, input)
  const counts = db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN featured=1 THEN 1 ELSE 0 END) featured,
    SUM(CASE WHEN price_cents=0 THEN 1 ELSE 0 END) free FROM prompts`).get() as Record<string, number>
  const categories = db.prepare('SELECT name, (SELECT COUNT(*) FROM prompts p WHERE p.category_id=c.id) count FROM categories c ORDER BY position').all()
  const cartCount = (db.prepare('SELECT COALESCE(SUM(quantity),0) count FROM cart_items WHERE user_id=?').get(DEMO_USER) as {count:number}).count
  return { prompts, counts, categories, cartCount }
}

export function getPrompt(db: DatabaseSync, id: string) {
  const row = db.prepare(`${promptSelect} WHERE p.id=?`).get(DEMO_USER, id) as Record<string,unknown> | undefined
  return row ? mapPrompt(row) : null
}

export function toggleFavorite(db: DatabaseSync, promptId: string) {
  const exists = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND prompt_id=?').get(DEMO_USER,promptId)
  if (exists) db.prepare('DELETE FROM favorites WHERE user_id=? AND prompt_id=?').run(DEMO_USER,promptId)
  else db.prepare("INSERT INTO favorites VALUES(?,?,datetime('now'))").run(DEMO_USER,promptId)
  return { favorite: !exists }
}

export function addCartItem(db: DatabaseSync, promptId: string) {
  db.prepare(`INSERT INTO cart_items(user_id,prompt_id,quantity,created_at) VALUES(?,?,1,datetime('now'))
    ON CONFLICT(user_id,prompt_id) DO UPDATE SET quantity=quantity+1`).run(DEMO_USER,promptId)
  return getCart(db)
}
export function removeCartItem(db: DatabaseSync, promptId: string) {
  db.prepare('DELETE FROM cart_items WHERE user_id=? AND prompt_id=?').run(DEMO_USER,promptId)
  return getCart(db)
}

export function getCart(db: DatabaseSync): CartSummary {
  const rows = db.prepare(`SELECT ${promptColumns},ci.quantity,(p.price_cents*ci.quantity) lineTotalCents
    FROM prompts p JOIN cart_items ci ON ci.prompt_id=p.id
    JOIN creators cr ON cr.id=p.creator_id JOIN categories c ON c.id=p.category_id
    LEFT JOIN favorites f ON f.prompt_id=p.id AND f.user_id=? WHERE ci.user_id=? ORDER BY ci.created_at`).all(DEMO_USER,DEMO_USER) as Record<string,unknown>[]
  const totals = db.prepare(`SELECT COALESCE(SUM(p.price_cents*ci.quantity),0) subtotalCents,
    ROUND(COALESCE(SUM(p.price_cents*ci.quantity),0)*.05) feeCents,
    COALESCE(SUM(ci.quantity),0) itemCount FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id WHERE ci.user_id=?`).get(DEMO_USER) as Record<string,number>
  return { items: rows.map((r) => ({...mapPrompt(r),quantity:Number(r.quantity),lineTotalCents:Number(r.lineTotalCents)})),
    itemCount: totals.itemCount, subtotalCents: totals.subtotalCents, feeCents: totals.feeCents,
    totalCents: totals.subtotalCents + totals.feeCents }
}

export function checkout(db: DatabaseSync) {
  const cart = getCart(db)
  if (!cart.itemCount) throw new Error('Cart is empty')
  const id = `order-${Date.now()}`
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare("INSERT INTO orders VALUES(?,?,?,?,?,?,datetime('now'))").run(id,DEMO_USER,'completed',cart.subtotalCents,cart.feeCents,cart.totalCents)
    const insert = db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?)')
    cart.items.forEach((item) => insert.run(id,item.id,item.creatorId,item.quantity,item.priceCents))
    db.prepare('DELETE FROM cart_items WHERE user_id=?').run(DEMO_USER)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return { id, totalCents: cart.totalCents, itemCount: cart.itemCount }
}

export function analytics(db: DatabaseSync) {
  const overview = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status='completed' THEN total_cents END),0) grossRevenueCents,
    ROUND(AVG(CASE WHEN status='completed' THEN total_cents END)) averageOrderValueCents,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completedOrders FROM orders`).get()
  const conversion = db.prepare(`SELECT ROUND(100.0*SUM(checkouts)/SUM(visits),2) conversionRate FROM daily_metrics`).get()
  const creators = db.prepare(`SELECT cr.name,COUNT(DISTINCT o.id) orders,
    SUM(oi.unit_price_cents*oi.quantity) grossCents,ROUND(SUM(oi.unit_price_cents*oi.quantity)*.85) revenueCents
    FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.status='completed' JOIN creators cr ON cr.id=oi.creator_id
    GROUP BY cr.id ORDER BY revenueCents DESC`).all()
  const categories = db.prepare(`SELECT c.name,SUM(oi.unit_price_cents*oi.quantity) revenueCents
    FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.status='completed'
    JOIN prompts p ON p.id=oi.prompt_id JOIN categories c ON c.id=p.category_id GROUP BY c.id ORDER BY revenueCents DESC`).all()
  const daily = db.prepare(`SELECT d.day,d.visits,d.checkouts,COALESCE(SUM(o.total_cents),0) salesCents,
    ROUND(100.0*d.checkouts/d.visits,2) conversionRate FROM daily_metrics d LEFT JOIN orders o ON date(o.created_at)=d.day AND o.status='completed'
    GROUP BY d.day ORDER BY d.day`).all()
  return { overview: { ...(overview as object), ...(conversion as object) }, creators, categories, daily }
}
