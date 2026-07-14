import Database from 'better-sqlite3'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { categories, creators, orderItems, orders, prompts } from './seed-data'
import type { AnalyticsResult, CartResult, CatalogResult, Prompt, SortKey } from './types'

const USER_ID = 1

export class MarketplaceDb {
  readonly db: Database.Database

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('foreign_keys = ON')
    const schema = readFileSync(join(process.cwd(), 'src/data/schema.sql'), 'utf8')
    this.db.exec(schema)
    if ((this.db.prepare('SELECT COUNT(*) AS n FROM prompts').get() as { n: number }).n === 0) this.seed()
  }

  close() { this.db.close() }

  seed() {
    const insertAll = this.db.transaction(() => {
      creators.forEach((c, i) => this.db.prepare('INSERT INTO creators(id,name,handle,initials) VALUES(?,?,?,?)').run(i + 1, ...c))
      categories.forEach((name, i) => this.db.prepare('INSERT INTO categories(id,name,slug) VALUES(?,?,?)').run(i + 1, name, name.toLowerCase()))
      this.db.prepare('INSERT INTO users(id,name,email) VALUES(1,?,?)').run('Alex Morgan', 'alex@powerprompt.local')
      const promptStmt = this.db.prepare(`INSERT INTO prompts
        (id,slug,title,model,category_id,price,sold_count,rating,creator_id,aspect_ratio,description,image,featured,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      prompts.forEach((p, index) => {
        const [id, slug, title, model, category, price, sold, rating, creatorId, aspect, description] = p
        const categoryId = categories.indexOf(category) + 1
        const day = String((index % 22) + 1).padStart(2, '0')
        promptStmt.run(id, slug, title, model, categoryId, price, sold, rating, creatorId, aspect, description, `/media/prompt-${id}.jpg`, index < 9 ? 1 : 0, `2026-06-${day}T10:00:00Z`)
      })
      this.db.prepare('INSERT INTO favorites(user_id,prompt_id) VALUES(1,207),(1,160)').run()
      this.db.prepare('INSERT INTO cart_items(user_id,prompt_id,quantity) VALUES(1,301,1)').run()
      const orderStmt = this.db.prepare('INSERT INTO orders(id,reference,status,created_at,user_id) VALUES(?,?,?,?,?)')
      orders.forEach((o, i) => orderStmt.run(i + 1, o[0], o[1], o[2], o[3]))
      const itemStmt = this.db.prepare('INSERT INTO order_items(order_id,prompt_id,quantity,unit_price) VALUES(?,?,?,?)')
      orderItems.forEach((i) => itemStmt.run(...i))
      const viewStmt = this.db.prepare('INSERT INTO prompt_views(prompt_id,viewed_at) VALUES(?,?)')
      prompts.forEach((p, pi) => {
        const views = 18 + (pi % 6) * 7
        for (let v = 0; v < views; v++) viewStmt.run(p[0], `2026-07-${String(8 + (v % 7)).padStart(2, '0')}T${String(8 + (v % 10)).padStart(2, '0')}:00:00Z`)
      })
    })
    insertAll()
  }

  listCatalog(input: { model?: string; category?: string; sort?: SortKey; search?: string; favorites?: boolean; price?: 'all' | 'free' | 'paid' } = {}): CatalogResult {
    const where: string[] = []
    const values: Array<string | number> = []
    if (input.model && input.model !== 'all') { where.push('p.model = ?'); values.push(input.model) }
    if (input.category && input.category !== 'all') { where.push('c.slug = ?'); values.push(input.category) }
    if (input.search?.trim()) { where.push('(LOWER(p.title) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(p.model) LIKE ? OR LOWER(c.name) LIKE ?)'); const q = `%${input.search.trim().toLowerCase()}%`; values.push(q, q, q, q) }
    if (input.favorites) where.push('f.prompt_id IS NOT NULL')
    if (input.price === 'free') where.push('p.price = 0')
    if (input.price === 'paid') where.push('p.price > 0')
    const sort = input.sort ?? 'featured'
    const order = sort === 'newest' ? 'p.created_at DESC, p.id DESC' : sort === 'popular' ? 'p.rating DESC, p.sold_count DESC' : 'rank_score DESC'
    const rows = this.db.prepare(`
      SELECT p.*, c.name category, c.slug category_slug, cr.name creator, cr.handle creator_handle,
        CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END favorite,
        ROUND((p.sold_count * .5) + (p.rating * 400) + (p.featured * 1000), 2) rank_score
      FROM prompts p JOIN categories c ON c.id=p.category_id JOIN creators cr ON cr.id=p.creator_id
      LEFT JOIN favorites f ON f.prompt_id=p.id AND f.user_id=${USER_ID}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order}
    `).all(...values) as Record<string, unknown>[]
    const promptRows = rows.map(mapPrompt)
    const categoryRows = this.db.prepare(`SELECT c.name, c.slug, COUNT(p.id) count FROM categories c LEFT JOIN prompts p ON p.category_id=c.id GROUP BY c.id ORDER BY c.id`).all() as CatalogResult['categories']
    const countRow = this.db.prepare(`SELECT COUNT(*) all_count, SUM(CASE WHEN price=0 THEN 1 ELSE 0 END) free_count, SUM(CASE WHEN price>0 THEN 1 ELSE 0 END) paid_count FROM prompts`).get() as Record<string, number>
    const favoriteCount = (this.db.prepare('SELECT COUNT(*) n FROM favorites WHERE user_id=?').get(USER_ID) as { n: number }).n
    const cartCount = (this.db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM cart_items WHERE user_id=?').get(USER_ID) as { n: number }).n
    return { prompts: promptRows, categories: categoryRows, counts: { all: countRow.all_count, free: countRow.free_count, paid: countRow.paid_count, favorites: favoriteCount }, cartCount }
  }

  getPrompt(slug: string): Prompt | null {
    const row = this.db.prepare(`SELECT p.*, c.name category, c.slug category_slug, cr.name creator, cr.handle creator_handle,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END favorite,
      ROUND((p.sold_count * .5) + (p.rating * 400) + (p.featured * 1000),2) rank_score
      FROM prompts p JOIN categories c ON c.id=p.category_id JOIN creators cr ON cr.id=p.creator_id
      LEFT JOIN favorites f ON f.prompt_id=p.id AND f.user_id=? WHERE p.slug=?`).get(USER_ID, slug) as Record<string, unknown> | undefined
    return row ? mapPrompt(row) : null
  }

  toggleFavorite(promptId: number) {
    const exists = this.db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND prompt_id=?').get(USER_ID, promptId)
    if (exists) this.db.prepare('DELETE FROM favorites WHERE user_id=? AND prompt_id=?').run(USER_ID, promptId)
    else this.db.prepare('INSERT INTO favorites(user_id,prompt_id) VALUES(?,?)').run(USER_ID, promptId)
    return { favorite: !exists, count: (this.db.prepare('SELECT COUNT(*) n FROM favorites WHERE user_id=?').get(USER_ID) as { n: number }).n }
  }

  addToCart(promptId: number) {
    this.db.prepare(`INSERT INTO cart_items(user_id,prompt_id,quantity) VALUES(?,?,1)
      ON CONFLICT(user_id,prompt_id) DO UPDATE SET quantity=quantity+1`).run(USER_ID, promptId)
    return this.getCart()
  }

  setCartQuantity(promptId: number, quantity: number) {
    if (quantity <= 0) this.db.prepare('DELETE FROM cart_items WHERE user_id=? AND prompt_id=?').run(USER_ID, promptId)
    else this.db.prepare('UPDATE cart_items SET quantity=? WHERE user_id=? AND prompt_id=?').run(quantity, USER_ID, promptId)
    return this.getCart()
  }

  getCart(): CartResult {
    const rows = this.db.prepare(`SELECT p.*, c.name category, c.slug category_slug, cr.name creator, cr.handle creator_handle,
      ci.quantity, CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END favorite,
      ROUND((p.sold_count * .5) + (p.rating * 400) + (p.featured * 1000),2) rank_score
      FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id JOIN categories c ON c.id=p.category_id
      JOIN creators cr ON cr.id=p.creator_id LEFT JOIN favorites f ON f.prompt_id=p.id AND f.user_id=ci.user_id
      WHERE ci.user_id=? ORDER BY p.title`).all(USER_ID) as Record<string, unknown>[]
    const totals = this.db.prepare(`SELECT ROUND(COALESCE(SUM(p.price*ci.quantity),0),2) subtotal,
      ROUND(COALESCE(SUM(p.price*ci.quantity),0)*.05,2) fee,
      ROUND(COALESCE(SUM(p.price*ci.quantity),0)*1.05,2) total, COALESCE(SUM(ci.quantity),0) count
      FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id WHERE ci.user_id=?`).get(USER_ID) as Omit<CartResult, 'items'>
    return { items: rows.map((r) => ({ ...mapPrompt(r), quantity: Number(r.quantity) })), ...totals }
  }

  checkout() {
    const cart = this.getCart()
    if (!cart.count) throw new Error('Your cart is empty')
    const result = this.db.transaction(() => {
      const next = (this.db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM orders').get() as { n: number }).n
      const reference = `PP-${1040 + next}`
      this.db.prepare('INSERT INTO orders(id,reference,user_id,status,created_at) VALUES(?,?,?,\'completed\',?)').run(next, reference, USER_ID, new Date().toISOString())
      const addItem = this.db.prepare('INSERT INTO order_items(order_id,prompt_id,quantity,unit_price) VALUES(?,?,?,?)')
      const addSold = this.db.prepare('UPDATE prompts SET sold_count=sold_count+? WHERE id=?')
      cart.items.forEach((item) => { addItem.run(next, item.id, item.quantity, item.price); addSold.run(item.quantity, item.id) })
      this.db.prepare('DELETE FROM cart_items WHERE user_id=?').run(USER_ID)
      return { reference, total: cart.total, items: cart.count }
    })()
    return result
  }

  analytics(): AnalyticsResult {
    const summary = this.db.prepare(`SELECT
      ROUND(COALESCE(SUM(CASE WHEN o.status='completed' THEN oi.quantity*oi.unit_price END),0),2) revenue,
      ROUND(COALESCE(SUM(CASE WHEN o.status='completed' THEN oi.quantity*oi.unit_price*.85 END),0),2) creatorRevenue,
      COUNT(DISTINCT CASE WHEN o.status='completed' THEN o.id END) orders,
      ROUND(100.0*COALESCE(SUM(CASE WHEN o.status='completed' THEN oi.quantity END),0)/(SELECT COUNT(*) FROM prompt_views),2) conversionRate,
      ROUND(COALESCE(SUM(CASE WHEN o.status='completed' THEN oi.quantity*oi.unit_price END),0)/NULLIF(COUNT(DISTINCT CASE WHEN o.status='completed' THEN o.id END),0),2) averageOrderValue,
      (SELECT ROUND(AVG(price),2) FROM prompts) averagePromptPrice
      FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id`).get() as AnalyticsResult['summary']
    const daily = this.db.prepare(`SELECT SUBSTR(o.created_at,1,10) day, ROUND(SUM(oi.quantity*oi.unit_price),2) sales, COUNT(DISTINCT o.id) orders
      FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.status='completed' GROUP BY day ORDER BY day`).all() as AnalyticsResult['daily']
    const categoryRows = this.db.prepare(`SELECT c.name, ROUND(SUM(oi.quantity*oi.unit_price),2) revenue, SUM(oi.quantity) units
      FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN prompts p ON p.id=oi.prompt_id JOIN categories c ON c.id=p.category_id
      WHERE o.status='completed' GROUP BY c.id ORDER BY revenue DESC`).all() as AnalyticsResult['categories']
    const creatorRows = this.db.prepare(`SELECT cr.name,cr.handle,ROUND(COALESCE(SUM(CASE WHEN o.status='completed' THEN oi.quantity*oi.unit_price*.85 END),0),2) revenue,
      COALESCE(SUM(CASE WHEN o.status='completed' THEN oi.quantity END),0) sales, COUNT(DISTINCT p.id) prompts
      FROM creators cr JOIN prompts p ON p.creator_id=cr.id LEFT JOIN order_items oi ON oi.prompt_id=p.id LEFT JOIN orders o ON o.id=oi.order_id
      GROUP BY cr.id ORDER BY revenue DESC`).all() as AnalyticsResult['creators']
    const topPrompts = this.db.prepare(`SELECT p.title,p.image,p.model,ROUND(SUM(oi.quantity*oi.unit_price),2) revenue,SUM(oi.quantity) units
      FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN prompts p ON p.id=oi.prompt_id WHERE o.status='completed'
      GROUP BY p.id ORDER BY revenue DESC LIMIT 5`).all() as AnalyticsResult['topPrompts']
    return { summary, daily, categories: categoryRows, creators: creatorRows, topPrompts }
  }
}

function mapPrompt(r: Record<string, unknown>): Prompt {
  return {
    id: Number(r.id), slug: String(r.slug), title: String(r.title), model: String(r.model), category: String(r.category), categorySlug: String(r.category_slug),
    price: Number(r.price), sold: Number(r.sold_count), rating: Number(r.rating), creator: String(r.creator), creatorHandle: String(r.creator_handle),
    aspectRatio: String(r.aspect_ratio), description: String(r.description), image: String(r.image), featured: Number(r.featured), favorite: Number(r.favorite), rankScore: Number(r.rank_score),
  }
}

let singleton: MarketplaceDb | undefined
export function getDb() {
  if (!singleton) singleton = new MarketplaceDb(process.env.POWERPROMPT_DB || join(process.cwd(), 'data/powerprompt.sqlite'))
  return singleton
}
