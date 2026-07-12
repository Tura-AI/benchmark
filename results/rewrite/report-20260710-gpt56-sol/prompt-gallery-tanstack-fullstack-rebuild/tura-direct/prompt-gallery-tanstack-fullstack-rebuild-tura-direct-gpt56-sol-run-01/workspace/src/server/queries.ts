import type { Analytics, CartSummary, CatalogInput, CatalogResult, Prompt } from '../contracts'
import type { PowerPromptDb } from './db'

const promptSelect = `p.id,p.slug,p.title,p.model,p.category,p.price_cents / 100.0 AS price,p.sold,p.views,p.rating,p.creator_id AS creatorId,c.name AS creator,p.aspect,p.description,p.image,p.featured,p.created_at AS createdAt,EXISTS(SELECT 1 FROM favorites f WHERE f.prompt_id=p.id AND f.user_id=@userId) AS favorite`

export function getCatalog(db: PowerPromptDb, input: CatalogInput, userId = 1): CatalogResult {
  const where = [`(@model = 'all' OR p.model = @model)`, `(@category = 'all' OR p.category = @category)`, `(@search = '' OR p.title LIKE '%' || @search || '%' OR p.description LIKE '%' || @search || '%')`, `(@favorites = 0 OR EXISTS(SELECT 1 FROM favorites fx WHERE fx.prompt_id=p.id AND fx.user_id=@userId))`, `(@free = 0 OR p.price_cents=0)`].join(' AND ')
  const order = input.sort === 'newest' ? 'p.created_at DESC' : input.sort === 'popular' ? 'p.sold DESC' : 'p.featured DESC,p.sold DESC,p.rating DESC'
  const params = { ...input, favorites: Number(input.favorites), free: Number(input.free), userId }
  const prompts = db.prepare(`SELECT ${promptSelect},ROW_NUMBER() OVER(ORDER BY ${order}) AS rank FROM prompts p JOIN creators c ON c.id=p.creator_id WHERE ${where} ORDER BY ${order}`).all(params) as Prompt[]
  const counts = db.prepare(`SELECT COUNT(*) total,SUM(price_cents=0) free,SUM(price_cents>0) paid,SUM(featured=1) featured,SUM(EXISTS(SELECT 1 FROM favorites f WHERE f.prompt_id=p.id AND f.user_id=?)) favorites FROM prompts p`).get(userId) as CatalogResult['counts']
  const categories = db.prepare('SELECT category name,COUNT(*) count FROM prompts GROUP BY category ORDER BY count DESC,name').all() as CatalogResult['categories']
  return { prompts, counts, categories }
}

export function getPrompt(db: PowerPromptDb, promptId: number, userId = 1) {
  return db.prepare(`SELECT ${promptSelect},1 AS rank FROM prompts p JOIN creators c ON c.id=p.creator_id WHERE p.id=@promptId`).get({ promptId, userId }) as Prompt | undefined
}

export function toggleFavorite(db: PowerPromptDb, promptId: number, userId = 1) {
  const exists = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND prompt_id=?').get(userId, promptId)
  if (exists) db.prepare('DELETE FROM favorites WHERE user_id=? AND prompt_id=?').run(userId, promptId)
  else db.prepare('INSERT INTO favorites(user_id,prompt_id) VALUES (?,?)').run(userId, promptId)
  return { favorite: !exists }
}

export function setCartQuantity(db: PowerPromptDb, promptId: number, quantity: number, userId = 1) {
  if (quantity === 0) db.prepare('DELETE FROM cart_items WHERE user_id=? AND prompt_id=?').run(userId, promptId)
  else db.prepare('INSERT INTO cart_items(user_id,prompt_id,quantity) VALUES (?,?,?) ON CONFLICT(user_id,prompt_id) DO UPDATE SET quantity=excluded.quantity').run(userId, promptId, quantity)
  return getCart(db, userId)
}

export function getCart(db: PowerPromptDb, userId = 1): CartSummary {
  const items = db.prepare(`SELECT ${promptSelect},ci.quantity,(p.price_cents*ci.quantity)/100.0 lineTotal,1 rank FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id JOIN creators c ON c.id=p.creator_id WHERE ci.user_id=@userId ORDER BY ci.rowid`).all({ userId }) as CartSummary['items']
  const totals = db.prepare(`SELECT COALESCE(SUM(p.price_cents*ci.quantity),0) subtotal,COALESCE(ROUND(SUM(p.price_cents*ci.quantity)*0.08),0) fee,COALESCE(SUM(p.price_cents*ci.quantity)+ROUND(SUM(p.price_cents*ci.quantity)*0.08),0) total,COALESCE(SUM(ci.quantity),0) itemCount FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id WHERE ci.user_id=?`).get(userId) as { subtotal:number; fee:number; total:number; itemCount:number }
  return { items, itemCount: totals.itemCount, subtotal: totals.subtotal / 100, fee: totals.fee / 100, total: totals.total / 100 }
}

export function checkout(db: PowerPromptDb, userId = 1) {
  return db.transaction(() => {
    const cart = getCart(db, userId)
    if (!cart.itemCount) throw new Error('Cart is empty')
    const now = new Date().toISOString().slice(0, 10)
    const order = db.prepare('INSERT INTO orders(user_id,status,subtotal_cents,fee_cents,total_cents,created_at) VALUES (?,\'paid\',?,?,?,?)').run(userId, Math.round(cart.subtotal*100), Math.round(cart.fee*100), Math.round(cart.total*100), now)
    const add = db.prepare('INSERT INTO order_items(order_id,prompt_id,creator_id,quantity,unit_price_cents) VALUES (?,?,?,?,?)')
    cart.items.forEach((item) => add.run(order.lastInsertRowid, item.id, item.creatorId, item.quantity, Math.round(item.price*100)))
    db.prepare('DELETE FROM cart_items WHERE user_id=?').run(userId)
    return { orderId: Number(order.lastInsertRowid), total: cart.total }
  })()
}

export function getAnalytics(db: PowerPromptDb, creatorId = 2): Analytics {
  const creator = db.prepare(`SELECT c.name,COALESCE(SUM(oi.quantity*oi.unit_price_cents),0)/100.0 revenue,COUNT(DISTINCT oi.order_id) orders,COALESCE(SUM(p.views),0) views,ROUND(100.0*COUNT(DISTINCT oi.order_id)/NULLIF(SUM(p.views),0),2) conversionRate,COALESCE(ROUND(SUM(oi.quantity*oi.unit_price_cents)*1.0/NULLIF(COUNT(DISTINCT oi.order_id),0))/100.0,0) averageOrderValue FROM creators c LEFT JOIN prompts p ON p.creator_id=c.id LEFT JOIN order_items oi ON oi.prompt_id=p.id AND oi.creator_id=c.id WHERE c.id=? GROUP BY c.id`).get(creatorId) as Analytics['creator']
  const categories = db.prepare(`SELECT p.category,ROUND(SUM(oi.quantity*oi.unit_price_cents))/100.0 revenue,SUM(oi.quantity) units FROM order_items oi JOIN prompts p ON p.id=oi.prompt_id GROUP BY p.category ORDER BY revenue DESC`).all() as Analytics['categories']
  const daily = db.prepare(`SELECT o.created_at day,COUNT(DISTINCT o.id) orders,SUM(o.total_cents)/100.0 revenue FROM orders o WHERE o.status='paid' GROUP BY o.created_at ORDER BY day`).all() as Analytics['daily']
  return { creator, categories, daily }
}
