import type Database from 'better-sqlite3'
import type { CartSummary, CatalogInput, Prompt } from '~/contracts'

type Row = Record<string, unknown>
const USER_ID = 1

function promptFromRow(row: Row): Prompt {
  return {
    id: Number(row.id), title: String(row.title), model: String(row.model), category: String(row.category),
    price: Number(row.price_cents) / 100, sold: Number(row.sold), rating: Number(row.rating),
    creatorId: Number(row.creator_id), creator: String(row.creator), aspectRatio: String(row.aspect_ratio),
    description: String(row.description), image: String(row.image), featured: Boolean(row.featured),
    createdAt: String(row.created_at), isFavorite: Boolean(row.is_favorite), rankScore: Number(row.rank_score),
  }
}

const promptFields = `p.*, c.name AS creator, cat.name AS category,
  EXISTS(SELECT 1 FROM favorites f WHERE f.prompt_id=p.id AND f.user_id=@userId) AS is_favorite,
  ROUND((p.rating * 20) + (LOG10(p.sold + 1) * 12) + (p.featured * 15), 2) AS rank_score`
const promptJoins = `FROM prompts p JOIN creators c ON c.id=p.creator_id JOIN categories cat ON cat.id=p.category_id`
const selectPrompt = `SELECT ${promptFields} ${promptJoins}`

export function listPrompts(db: Database.Database, input: CatalogInput): Prompt[] {
  const where = ['1=1']
  const params: Record<string, string | number> = { userId: USER_ID }
  if (input.model !== 'all') { where.push('p.model=@model'); params.model = input.model }
  if (input.category !== 'all') { where.push('cat.name=@category'); params.category = input.category }
  if (input.query) { where.push('(p.title LIKE @query OR p.description LIKE @query OR p.model LIKE @query OR cat.name LIKE @query)'); params.query = `%${input.query}%` }
  if (input.favoritesOnly) where.push('EXISTS(SELECT 1 FROM favorites fx WHERE fx.prompt_id=p.id AND fx.user_id=@userId)')
  if (input.price === 'free') where.push('p.price_cents=0')
  if (input.price === 'paid') where.push('p.price_cents>0')
  const order = input.sort === 'newest' ? 'p.created_at DESC, p.id DESC' : input.sort === 'popular' ? 'p.rating DESC, p.sold DESC' : 'rank_score DESC, p.id DESC'
  return (db.prepare(`${selectPrompt} WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(params) as Row[]).map(promptFromRow)
}

export function getPrompt(db: Database.Database, promptId: number) {
  const row = db.prepare(`${selectPrompt} WHERE p.id=@promptId`).get({ promptId, userId: USER_ID }) as Row | undefined
  return row ? promptFromRow(row) : null
}

export function getCatalogCounts(db: Database.Database) {
  return db.prepare(`SELECT COUNT(*) AS total,
    SUM(price_cents=0) AS free, SUM(price_cents>0) AS paid, SUM(featured=1) AS featured,
    (SELECT COUNT(*) FROM favorites WHERE user_id=@userId) AS favorites
    FROM prompts`).get({ userId: USER_ID }) as { total: number; free: number; paid: number; featured: number; favorites: number }
}

export function toggleFavorite(db: Database.Database, promptId: number) {
  const exists = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND prompt_id=?').get(USER_ID, promptId)
  if (exists) db.prepare('DELETE FROM favorites WHERE user_id=? AND prompt_id=?').run(USER_ID, promptId)
  else db.prepare("INSERT INTO favorites VALUES (?, ?, datetime('now'))").run(USER_ID, promptId)
  return { favorite: !exists, count: (db.prepare('SELECT COUNT(*) AS count FROM favorites WHERE user_id=?').get(USER_ID) as { count: number }).count }
}

export function addCartItem(db: Database.Database, promptId: number, quantity = 1) {
  const exists = db.prepare('SELECT id FROM prompts WHERE id=?').get(promptId)
  if (!exists) throw new Error('Prompt not found')
  db.prepare(`INSERT INTO cart_items (user_id,prompt_id,quantity,updated_at) VALUES (@userId,@promptId,@quantity,datetime('now'))
    ON CONFLICT(user_id,prompt_id) DO UPDATE SET quantity=MIN(10,quantity+excluded.quantity), updated_at=datetime('now')`).run({ userId: USER_ID, promptId, quantity })
  return getCartSummary(db)
}

export function removeCartItem(db: Database.Database, promptId: number) {
  db.prepare('DELETE FROM cart_items WHERE user_id=? AND prompt_id=?').run(USER_ID, promptId)
  return getCartSummary(db)
}

export function getCartSummary(db: Database.Database): CartSummary {
  const rows = db.prepare(`SELECT ${promptFields}, ci.quantity, (p.price_cents * ci.quantity) AS line_total
    FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id JOIN creators c ON c.id=p.creator_id JOIN categories cat ON cat.id=p.category_id
    WHERE ci.user_id=@userId ORDER BY ci.updated_at DESC`).all({ userId: USER_ID }) as Row[]
  const totals = db.prepare(`SELECT COALESCE(SUM(p.price_cents*ci.quantity),0) AS subtotal,
    ROUND(COALESCE(SUM(p.price_cents*ci.quantity),0)*0.05) AS fee,
    COALESCE(SUM(ci.quantity),0) AS item_count
    FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id WHERE ci.user_id=?`).get(USER_ID) as { subtotal: number; fee: number; item_count: number }
  return {
    items: rows.map((row) => ({ ...promptFromRow(row), quantity: Number(row.quantity), lineTotal: Number(row.line_total) / 100 })),
    itemCount: totals.item_count, subtotal: totals.subtotal / 100, serviceFee: totals.fee / 100, total: (totals.subtotal + totals.fee) / 100,
  }
}

export function checkout(db: Database.Database, email: string) {
  const cart = getCartSummary(db)
  if (!cart.items.length) throw new Error('Cart is empty')
  return db.transaction(() => {
    const result = db.prepare(`INSERT INTO orders (user_id,email,status,subtotal_cents,fee_cents,total_cents,created_at)
      VALUES (?,?,'paid',?,?,?,datetime('now'))`).run(USER_ID, email, Math.round(cart.subtotal * 100), Math.round(cart.serviceFee * 100), Math.round(cart.total * 100))
    const insert = db.prepare(`INSERT INTO order_items (order_id,prompt_id,creator_id,category_id,quantity,unit_price_cents)
      SELECT @orderId,p.id,p.creator_id,p.category_id,ci.quantity,p.price_cents FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id WHERE ci.user_id=@userId`)
    insert.run({ orderId: result.lastInsertRowid, userId: USER_ID })
    db.prepare('DELETE FROM cart_items WHERE user_id=?').run(USER_ID)
    return { orderId: Number(result.lastInsertRowid), ...cart }
  })()
}

export function getAnalytics(db: Database.Database) {
  const overview = db.prepare(`SELECT
    (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE status='paid')/100.0 AS revenue,
    (SELECT COUNT(*) FROM orders WHERE status='paid') AS orders,
    (SELECT ROUND(AVG(total_cents)/100.0,2) FROM orders WHERE status='paid') AS average_order_value,
    (SELECT ROUND(100.0*SUM(converted)/COUNT(*),1) FROM sessions) AS conversion_rate`).get() as { revenue: number; orders: number; average_order_value: number; conversion_rate: number }
  const creators = db.prepare(`SELECT c.id,c.name,ROUND(COALESCE(SUM(oi.quantity*oi.unit_price_cents)*0.85,0)/100.0,2) AS revenue,
    COALESCE(SUM(oi.quantity),0) AS units FROM creators c LEFT JOIN order_items oi ON oi.creator_id=c.id GROUP BY c.id ORDER BY revenue DESC`).all() as Array<{ id: number; name: string; revenue: number; units: number }>
  const categories = db.prepare(`SELECT cat.name,ROUND(COALESCE(SUM(oi.quantity*oi.unit_price_cents),0)/100.0,2) AS revenue,
    COALESCE(SUM(oi.quantity),0) AS units FROM categories cat LEFT JOIN order_items oi ON oi.category_id=cat.id GROUP BY cat.id ORDER BY revenue DESC`).all() as Array<{ name: string; revenue: number; units: number }>
  const daily = db.prepare(`SELECT date(created_at) AS day,COUNT(*) AS orders,ROUND(SUM(total_cents)/100.0,2) AS revenue
    FROM orders WHERE status='paid' GROUP BY date(created_at) ORDER BY day`).all() as Array<{ day: string; orders: number; revenue: number }>
  return { overview, creators, categories, daily }
}
