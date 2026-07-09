import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dbPath = path.join(root, 'db', 'powerprompt.sqlite')
const userId = 1

export type SortKey = 'featured' | 'newest' | 'popular'
export type CatalogFilters = { model?: string; category?: string; sort?: SortKey; term?: string; favorites?: boolean; free?: boolean }
export type Prompt = {
  id: number; title: string; slug: string; model: string; category: string; price: number; priceCents: number; sold: number; rating: number;
  creator: string; imageUrl: string; aspectRatio: string; description: string; featured: boolean; rankScore: number; isFavorite: boolean; inCart: boolean
}
export type CatalogResult = {
  prompts: Prompt[]
  counts: { all: number; featured: number; free: number; paid: number; favorites: number; cart: number }
  categories: Array<{ name: string; count: number; revenue: number }>
  models: string[]
}
export type CartSummary = { items: Array<Prompt & { quantity: number; lineTotal: number }>; subtotal: number; fees: number; total: number }
export type AdminAnalytics = {
  creatorRevenue: Array<{ creator: string; revenue: number; sales: number; conversionRate: number }>
  categoryRevenue: Array<{ category: string; revenue: number; units: number }>
  dailySales: Array<{ day: string; revenue: number; orders: number }>
  summary: { revenue: number; orders: number; averageOrderValue: number; conversionRate: number }
}

let singleton: DatabaseSync | undefined
export function appDb() {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  singleton ??= createDatabase(dbPath)
  return singleton
}
export function createTestDb() { return createDatabase(':memory:') }

function createDatabase(file: string) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS creators(id INTEGER PRIMARY KEY,name TEXT,handle TEXT,views INTEGER);
    CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY,name TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS prompts(id INTEGER PRIMARY KEY,creator_id INTEGER,category_id INTEGER,title TEXT,slug TEXT UNIQUE,model TEXT,price_cents INTEGER,sold INTEGER,rating REAL,aspect_ratio TEXT,description TEXT,featured INTEGER,created_at TEXT);
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER,prompt_id INTEGER,PRIMARY KEY(user_id,prompt_id));
    CREATE TABLE IF NOT EXISTS cart_items(user_id INTEGER,prompt_id INTEGER,quantity INTEGER DEFAULT 1,PRIMARY KEY(user_id,prompt_id));
    CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,user_id INTEGER,subtotal_cents INTEGER,fees_cents INTEGER,total_cents INTEGER,created_at TEXT);
    CREATE TABLE IF NOT EXISTS order_items(order_id INTEGER,prompt_id INTEGER,quantity INTEGER,unit_cents INTEGER);
  `)
  seed(db)
  return db
}

function seed(db: DatabaseSync) {
  if (one<{ count: number }>(db, 'SELECT COUNT(*) count FROM prompts').count) return
  ;[[1, 'Atlas Studio', '@atlas', 14200], [2, 'Field & Co.', '@field', 18100], [3, 'Lumen', '@lumen', 12900], [4, 'Ops Guild', '@opsguild', 21100]]
    .forEach((r) => db.prepare('INSERT INTO creators VALUES(?,?,?,?)').run(...r))
  ;['Image', 'Photography', 'Design', 'Writing', 'Code', 'Marketing', 'Productivity', 'Research']
    .forEach((name) => db.prepare('INSERT INTO categories(name) VALUES(?)').run(name))
  db.prepare('INSERT INTO users VALUES(?,?)').run(userId, 'Demo buyer')
  const prompts = [
    [207,1,'Image','Cinematic Still, 35mm','cinematic-still-35mm','Midjourney',900,4700,5,'3/4','Film-grade stills with lens language, grain, and cinematic lighting.',1,'2026-06-21'],
    [233,1,'Image','Ink Wash Warrior','ink-wash-warrior','Midjourney',1200,2100,4.9,'2/3','Sumi-e meets splash ink with controlled negative space.',1,'2026-06-19'],
    [174,3,'Photography','Editorial Photo Grade','editorial-photo-grade','Flux',1100,1300,4.9,'3/4','Magazine-style color grading with warm skin and deep shadow.',0,'2026-06-18'],
    [301,2,'Design','Magazine Cover Maker','magazine-cover-maker','GPT-4o',1400,3300,4.8,'4/5','Drop in a photo and get a full cover with masthead and cover lines.',1,'2026-06-27'],
    [118,3,'Photography','Studio Portrait, Soft Light','studio-portrait-soft-light','Flux',1000,1800,4.9,'4/5','Clean beauty light with believable falloff.',1,'2026-06-13'],
    [198,2,'Design','Logo Sketch, Mono-line','logo-sketch-monoline','Midjourney',1300,980,4.8,'1/1','Single-weight line marks with vector-ready directions.',0,'2026-06-14'],
    [142,4,'Marketing','The Cold-Email Closer','cold-email-closer','GPT-4o',1200,2300,4.9,'4/3','Cold emails that get replies with tested subject variants.',1,'2026-06-16'],
    [160,4,'Code','Senior Code Reviewer','senior-code-reviewer','Claude',1800,1100,4.8,'1/1','Reviews your diff like a staff engineer.',0,'2026-06-12'],
    [255,1,'Photography','Neon Street, Night','neon-street-night','Flux',800,2600,4.7,'3/4','Rain-slick neon with real reflections and grain.',1,'2026-06-23'],
    [189,2,'Marketing','Brand Voice, Bottled','brand-voice-bottled','Claude',2400,860,4.9,'4/3','Turns samples into a reusable voice guide.',0,'2026-06-11'],
    [211,1,'Image','Anime Key Visual','anime-key-visual','Midjourney',1500,3900,5,'2/3','Poster-grade key art with depth and rim light.',1,'2026-06-22'],
    [31,4,'Research','The Socratic Tutor','socratic-tutor','GPT-4o',0,9200,4.7,'5/4','Leads learners through questions at the right difficulty.',1,'2026-06-01'],
    [276,3,'Photography','Product Shot, White BG','product-shot-white-bg','Flux',900,1500,4.8,'1/1','Clean e-commerce hero shots with soft contact shadow.',0,'2026-06-24'],
    [212,2,'Writing',"The Worldbuilder's Bible",'worldbuilders-bible','GPT-4o',2900,720,5,'4/5','Builds consistent fictional worlds and continuity.',0,'2026-06-17'],
    [248,2,'Design','Vintage Film Poster','vintage-film-poster','Midjourney',1300,2200,4.9,'3/4','70s grain, bold type, and halftone one-sheets.',1,'2026-06-20'],
    [156,4,'Code','Bug-to-Test Generator','bug-to-test-generator','GPT-4o',1500,1900,4.8,'4/3','Turns bug reports into failing tests and edge cases.',0,'2026-06-15'],
    [267,3,'Photography','Dreamy Bokeh Portrait','dreamy-bokeh-portrait','Flux',1000,1700,4.8,'4/5','Creamy backgrounds and golden-hour warmth.',1,'2026-06-25'],
    [101,4,'Productivity','Meeting to Memo','meeting-to-memo','Claude',600,5100,4.7,'4/3','Turns transcripts into crisp decision memos.',1,'2026-06-08'],
    [290,1,'Image','Concept Car, Studio','concept-car-studio','Midjourney',1200,1400,4.8,'3/2','Automotive design renders with believable reflections.',0,'2026-06-26'],
    [77,2,'Writing','The Plot Doctor','plot-doctor','Claude',1600,1400,4.9,'1/1','Diagnoses why stories stall and prescribes fixes.',0,'2026-06-07'],
    [221,1,'Image','Watercolor Cityscape','watercolor-cityscape','Flux',900,2000,4.9,'3/4','Loose luminous washes with confident linework.',1,'2026-06-10'],
    [63,4,'Productivity','Inbox Zero Strategist','inbox-zero-strategist','Claude',800,3400,4.6,'4/3','Triage, draft, and schedule a full inbox in one pass.',0,'2026-06-06'],
  ] as const
  const insert = db.prepare('INSERT INTO prompts VALUES(?,?,(SELECT id FROM categories WHERE name=?),?,?,?,?,?,?,?,?,?,?)')
  prompts.forEach((p) => insert.run(...p))
  ;[207, 31, 142].forEach((id) => db.prepare('INSERT INTO favorites VALUES(?,?)').run(userId, id))
  ;[301, 31].forEach((id) => db.prepare('INSERT INTO cart_items VALUES(?,?,1)').run(userId, id))
  ;[[1,'2026-07-01',[207,142,31]],[2,'2026-07-02',[211,101]],[3,'2026-07-03',[301,255,248]],[4,'2026-07-04',[189]],[5,'2026-07-05',[160,156]],[6,'2026-07-06',[276,267,118]],[7,'2026-07-07',[212,77]],[8,'2026-07-08',[233,221,290]]]
    .forEach(([id, day, ids]) => insertOrder(db, id as number, day as string, ids as number[]))
}

function insertOrder(db: DatabaseSync, id: number, day: string, ids: number[]) {
  const prices = all<{ id: number; price_cents: number }>(db, `SELECT id,price_cents FROM prompts WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
  const subtotal = prices.reduce((s, r) => s + r.price_cents, 0)
  const fees = Math.round(subtotal * 0.06)
  db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(id, userId, subtotal, fees, subtotal + fees, `${day}T10:00:00.000Z`)
  prices.forEach((p) => db.prepare('INSERT INTO order_items VALUES(?,?,1,?)').run(id, p.id, p.price_cents))
}

function select(extra = '') {
  return `SELECT p.id,p.title,p.slug,p.model,c.name category,p.price_cents priceCents,p.sold,p.rating,cr.name creator,p.aspect_ratio aspectRatio,p.description,p.featured=1 featured,
    ('https://picsum.photos/seed/pp'||p.id||'/900/1200') imageUrl,
    ((p.sold*.62)+(p.rating*320)+CASE WHEN p.featured=1 THEN 900 ELSE 0 END) rankScore,
    EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=? AND f.prompt_id=p.id) isFavorite,
    EXISTS(SELECT 1 FROM cart_items x WHERE x.user_id=? AND x.prompt_id=p.id) inCart ${extra}
    FROM prompts p JOIN categories c ON c.id=p.category_id JOIN creators cr ON cr.id=p.creator_id`
}

export function getCatalog(db = appDb(), f: CatalogFilters = {}): CatalogResult {
  const params: unknown[] = [userId, userId], where = ['1=1']
  if (f.model && f.model !== 'all') { where.push('p.model=?'); params.push(f.model) }
  if (f.category && f.category !== 'all') { where.push('c.name=?'); params.push(f.category) }
  if (f.term) { where.push("LOWER(p.title||' '||p.description||' '||p.model||' '||c.name) LIKE ?"); params.push(`%${f.term.toLowerCase()}%`) }
  if (f.favorites) where.push('EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=1 AND f.prompt_id=p.id)')
  if (f.free) where.push('p.price_cents=0')
  const order = f.sort === 'newest' ? 'p.created_at DESC,p.id DESC' : f.sort === 'popular' ? 'p.rating DESC,p.sold DESC' : 'rankScore DESC,p.created_at DESC'
  const prompts = all<Prompt>(db, `${select()} WHERE ${where.join(' AND ')} ORDER BY ${order}`, params).map(norm)
  return {
    prompts,
    counts: one(db, 'SELECT COUNT(*) "all",SUM(featured=1) featured,SUM(price_cents=0) free,SUM(price_cents>0) paid,(SELECT COUNT(*) FROM favorites WHERE user_id=1) favorites,(SELECT COUNT(*) FROM cart_items WHERE user_id=1) cart FROM prompts'),
    categories: all(db, 'SELECT c.name,COUNT(p.id) count,COALESCE(SUM(oi.quantity*oi.unit_cents),0)/100.0 revenue FROM categories c LEFT JOIN prompts p ON p.category_id=c.id LEFT JOIN order_items oi ON oi.prompt_id=p.id GROUP BY c.id ORDER BY c.name'),
    models: all<{ model: string }>(db, 'SELECT DISTINCT model FROM prompts ORDER BY model').map((r) => r.model),
  }
}

export function getPromptBySlug(db = appDb(), slug: string) { const r = maybe<Prompt>(db, `${select()} WHERE p.slug=?`, [userId, userId, slug]); return r && norm(r) }
export function toggleFavorite(db = appDb(), id: number) {
  const exists = maybe(db, 'SELECT 1 FROM favorites WHERE user_id=? AND prompt_id=?', [userId, id])
  db.prepare(exists ? 'DELETE FROM favorites WHERE user_id=? AND prompt_id=?' : 'INSERT INTO favorites VALUES(?,?)').run(userId, id)
  return { favorite: !exists, counts: getCatalog(db).counts }
}
export function addToCart(db = appDb(), id: number) { db.prepare('INSERT INTO cart_items VALUES(?,?,1) ON CONFLICT(user_id,prompt_id) DO UPDATE SET quantity=quantity+1').run(userId, id); return getCart(db) }
export function removeFromCart(db = appDb(), id: number) { db.prepare('DELETE FROM cart_items WHERE user_id=? AND prompt_id=?').run(userId, id); return getCart(db) }
export function getCart(db = appDb()): CartSummary {
  const rows = all<Prompt & { quantity: number; lineTotalCents: number }>(db, `${select(',ci.quantity,(ci.quantity*p.price_cents) lineTotalCents')} JOIN cart_items ci ON ci.prompt_id=p.id AND ci.user_id=? WHERE ci.user_id=?`, [userId, userId, userId, userId])
  const items = rows.map((r) => ({ ...norm(r), quantity: r.quantity, lineTotal: money(r.lineTotalCents) }))
  const t = one<{ subtotalCents: number; feesCents: number; totalCents: number }>(db, 'SELECT COALESCE(SUM(ci.quantity*p.price_cents),0) subtotalCents,ROUND(COALESCE(SUM(ci.quantity*p.price_cents),0)*.06) feesCents,COALESCE(SUM(ci.quantity*p.price_cents),0)+ROUND(COALESCE(SUM(ci.quantity*p.price_cents),0)*.06) totalCents FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id WHERE ci.user_id=1')
  return { items, subtotal: money(t.subtotalCents), fees: money(t.feesCents), total: money(t.totalCents) }
}
export function checkout(db = appDb()) {
  const cart = getCart(db)
  if (!cart.items.length) return { ok: false, cart, orderId: null }
  const id = one<{ id: number }>(db, 'SELECT COALESCE(MAX(id),0)+1 id FROM orders').id
  db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(id, userId, Math.round(cart.subtotal*100), Math.round(cart.fees*100), Math.round(cart.total*100), new Date().toISOString())
  cart.items.forEach((i) => db.prepare('INSERT INTO order_items VALUES(?,?,?,?)').run(id, i.id, i.quantity, i.priceCents))
  db.prepare('DELETE FROM cart_items WHERE user_id=?').run(userId)
  return { ok: true, cart: getCart(db), orderId: id, total: cart.total }
}
export function getAdminAnalytics(db = appDb()): AdminAnalytics {
  return {
    creatorRevenue: all(db, 'SELECT cr.name creator,COALESCE(SUM(oi.quantity*oi.unit_cents),0)/100.0 revenue,COALESCE(SUM(oi.quantity),0) sales,ROUND(COALESCE(SUM(oi.quantity),0)*1.0/cr.views,4) conversionRate FROM creators cr LEFT JOIN prompts p ON p.creator_id=cr.id LEFT JOIN order_items oi ON oi.prompt_id=p.id GROUP BY cr.id ORDER BY revenue DESC'),
    categoryRevenue: all(db, 'SELECT c.name category,COALESCE(SUM(oi.quantity*oi.unit_cents),0)/100.0 revenue,COALESCE(SUM(oi.quantity),0) units FROM categories c LEFT JOIN prompts p ON p.category_id=c.id LEFT JOIN order_items oi ON oi.prompt_id=p.id GROUP BY c.id ORDER BY revenue DESC'),
    dailySales: all(db, 'SELECT substr(created_at,1,10) day,SUM(total_cents)/100.0 revenue,COUNT(*) orders FROM orders GROUP BY day ORDER BY day'),
    summary: one(db, 'SELECT COALESCE(SUM(total_cents),0)/100.0 revenue,COUNT(*) orders,CASE WHEN COUNT(*)=0 THEN 0 ELSE AVG(total_cents)/100.0 END averageOrderValue,ROUND((SELECT COALESCE(SUM(quantity),0) FROM order_items)*1.0/(SELECT SUM(views) FROM creators),4) conversionRate FROM orders'),
  }
}

function norm<T extends Prompt>(r: T): T { return { ...r, price: money(r.priceCents), featured: !!r.featured, isFavorite: !!r.isFavorite, inCart: !!r.inCart } }
function money(cents: number) { return Math.round(cents) / 100 }
function all<T>(db: DatabaseSync, sql: string, params: unknown[] = []) { return db.prepare(sql).all(...params) as T[] }
function one<T>(db: DatabaseSync, sql: string, params: unknown[] = []) { return db.prepare(sql).get(...params) as T }
function maybe<T>(db: DatabaseSync, sql: string, params: unknown[] = []) { return db.prepare(sql).get(...params) as T | undefined }

if (!existsSync(path.dirname(dbPath))) mkdirSync(path.dirname(dbPath), { recursive: true })
