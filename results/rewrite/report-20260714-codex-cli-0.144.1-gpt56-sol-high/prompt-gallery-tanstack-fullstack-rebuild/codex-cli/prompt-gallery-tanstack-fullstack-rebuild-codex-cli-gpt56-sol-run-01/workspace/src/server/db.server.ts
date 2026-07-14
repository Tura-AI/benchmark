import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CartData, CatalogData, CatalogFilters, Prompt } from '../lib/types'

const defaultPath = join(process.cwd(), 'data', 'powerprompt.db')
let singleton: DatabaseSync | undefined

type SeedPrompt = [number, string, string, string, number, number, number, number, string, string, string, string]

const promptSeeds: SeedPrompt[] = [
  [207,'cinematic-still-35mm','Cinematic Still, 35mm','Midjourney',9,4700,23800,5.0,'Image','3/4','Film-grade stills with real lens language — focal length, grain, and lighting that reads as cinema.','A cinematic 35mm still of [SUBJECT], natural motivated light, Kodak Vision3 grain, shallow focus, authentic production design.'],
  [233,'ink-wash-warrior','Ink Wash Warrior','Midjourney',12,2100,11100,4.9,'Image','2/3','Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space.','Sumi-e warrior in motion, expressive splash ink, rice paper texture, disciplined negative space, one vermilion seal.'],
  [174,'editorial-photo-grade','Editorial Photo Grade','Flux',11,1300,8400,4.9,'Photography','3/4','Magazine-style color grading. Warm skin, deep shadow, that quiet print look — no garish presets.','Editorial portrait of [SUBJECT], soft window key, rich restrained shadows, warm skin, subtle print grain, 85mm lens.'],
  [301,'magazine-cover-maker','Magazine Cover Maker','GPT-4o',14,3300,19400,4.8,'Design','4/5','Drop in a photo, get a full cover — masthead, cover lines, barcode, the works.','Act as an award-winning editorial designer. Create a complete cover hierarchy around the supplied image and audience.'],
  [118,'studio-portrait-soft-light','Studio Portrait, Soft Light','Flux',10,1800,9700,4.9,'Photography','4/5','Clean beauty light with a believable falloff. Looks shot, not rendered.','Beauty portrait, large diffused octabox, gentle falloff, honest skin texture, neutral seamless, medium-format detail.'],
  [198,'logo-sketch-mono-line','Logo Sketch, Mono-line','Midjourney',13,980,6500,4.8,'Design','1/1','Single-weight line marks with real negative-space thinking. Vector-ready directions, fast.','Minimal monoline identity sketch for [BRAND], clever negative space, single consistent stroke, black on warm paper.'],
  [142,'cold-email-closer','The Cold-Email Closer','GPT-4o',12,2300,14100,4.9,'Marketing','4/3','Cold emails that actually get replies. A tested 4-line structure with subject-line variants baked in.','Write a four-line cold email using one specific observation, one credible outcome, and one frictionless question.'],
  [160,'senior-code-reviewer','Senior Code Reviewer','Claude',18,1100,8200,4.8,'Code','1/1','Reviews your diff like a staff engineer — catches risk, suggests fixes, explains the why.','Review this diff as a staff engineer. Prioritize correctness and operational risk; cite exact lines and propose minimal patches.'],
  [255,'neon-street-night','Neon Street, Night','Flux',8,2600,15700,4.7,'Photography','3/4','Rain-slick neon with real reflections and grain. That blade-runner-on-a-budget look, nailed.','Night street documentary photograph, wet asphalt, layered neon reflections, tungsten practicals, pushed 800T grain.'],
  [189,'brand-voice-bottled','Brand Voice, Bottled','Claude',24,860,6100,4.9,'Marketing','4/3','Feed it three samples; get a reusable voice guide that writes anything in your exact tone.','Analyze the samples for cadence, diction, humor, point of view and forbidden habits. Return a reusable voice system.'],
  [211,'anime-key-visual','Anime Key Visual','Midjourney',15,3900,22600,5.0,'Image','2/3','Poster-grade key art with depth, rim light, and a real focal subject. Print at A2.','Anime theatrical key visual, iconic central silhouette, strong foreground framing, atmospheric depth, luminous rim light.'],
  [31,'socratic-tutor','The Socratic Tutor','GPT-4o',0,9200,40200,4.7,'Research','5/4','Never hands you the answer — leads you there with questions at exactly the right difficulty.','Tutor me through [TOPIC] only with calibrated questions. Diagnose misconceptions and never reveal the next step too early.'],
  [276,'product-shot-white-bg','Product Shot, White BG','Flux',9,1500,9200,4.8,'Photography','1/1','Clean e-commerce hero shots with soft contact shadow. Drop-in ready for any storefront.','Premium catalog photograph of [PRODUCT], seamless warm-white cyclorama, large softboxes, realistic contact shadow.'],
  [212,'worldbuilders-bible',"The Worldbuilder's Bible",'GPT-4o',29,720,5800,5.0,'Writing','4/5','Builds a consistent fictional world — geography, factions, history — and holds continuity.','Build a living world bible. Track causal history, scarce resources, competing factions, geography and continuity conflicts.'],
  [248,'vintage-film-poster','Vintage Film Poster','Midjourney',13,2200,12700,4.9,'Design','3/4','70s grain, bold type, halftone. One-sheets that look pulled from an archive.','1970s international film one-sheet, hand-drawn key art, bold condensed title, offset misregistration, halftone patina.'],
  [156,'bug-to-test-generator','Bug-to-Test Generator','GPT-4o',15,1900,12100,4.8,'Code','4/3','Paste a bug report, get a failing test that reproduces it — plus the fix and the edge cases.','Convert this bug report into the smallest deterministic failing test, explain root cause, patch it, and cover adjacent edges.'],
  [267,'dreamy-bokeh-portrait','Dreamy Bokeh Portrait','Flux',10,1700,10300,4.8,'Photography','4/5','Creamy backgrounds, golden-hour warmth, eyes in razor focus. Pure mood.','Golden-hour portrait, 105mm f/1.4, razor-sharp eyes, creamy layered bokeh, natural backlight and skin.'],
  [101,'meeting-to-memo','Meeting → Memo','Claude',6,5100,24800,4.7,'Productivity','4/3','Turns a messy transcript into a crisp decision memo: owners, dates, the one thing that matters.','Turn this transcript into a one-page decision memo: context, decisions, unresolved risks, owners and dated next actions.'],
  [290,'concept-car-studio','Concept Car, Studio','Midjourney',12,1400,8800,4.8,'Image','3/2','Automotive design renders with believable studio reflections and a real sense of scale.','Automotive design study, [VEHICLE], full-scale studio cove, long stripbox reflections, grounded tires, 70mm lens.'],
  [77,'plot-doctor','The Plot Doctor','Claude',16,1400,9100,4.9,'Writing','1/1','Diagnoses why your story stalls and prescribes the fix — stakes, pacing, the scene you are dodging.','Diagnose this story without rewriting it. Identify the broken promise, weak causal link, missing pressure, and next necessary scene.'],
  [221,'watercolor-cityscape','Watercolor Cityscape','Flux',9,2000,11900,4.9,'Image','3/4','Loose, luminous washes with confident linework. Soft skies, busy streets.','Luminous travel-sketch cityscape, loose watercolor washes, confident ink line, wet-on-wet sky, lively street scale.'],
  [63,'inbox-zero-strategist','Inbox Zero Strategist','Claude',8,3400,18300,4.6,'Productivity','4/3','Triage, draft, and schedule a full inbox in one pass — sorted by what moves your week.','Triage these messages by consequence and urgency. Draft concise replies, extract commitments, and propose a realistic schedule.']
]

const creators = ['Atlas Studio','Sumi Lab','N. Sørensen','Field & Co.','Lumen','Studio Kö','Marta Vey','D. Okonkwo','Kuro','Sakuga','J. Halloran','E. Castellanos','R. Mehta','Ops Guild','Forme','H. Mbeki','Aquarelle','Lina P.','Reel']
const categories = ['Image','Photography','Design','Writing','Code','Marketing','Productivity','Research']

export function openDatabase(path = process.env.POWERPROMPT_DB || defaultPath) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
  migrate(db)
  seed(db)
  return db
}

export function getDb() {
  if (!singleton) singleton = openDatabase()
  return singleton
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creators (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, handle TEXT NOT NULL, joined_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, model TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id), creator_id INTEGER NOT NULL REFERENCES creators(id),
      price REAL NOT NULL, sold INTEGER NOT NULL, views INTEGER NOT NULL, rating REAL NOT NULL,
      aspect TEXT NOT NULL, description TEXT NOT NULL, prompt_text TEXT NOT NULL, image_url TEXT NOT NULL,
      featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS favorites (user_id INTEGER REFERENCES users(id), prompt_id INTEGER REFERENCES prompts(id), created_at TEXT NOT NULL, PRIMARY KEY(user_id,prompt_id));
    CREATE TABLE IF NOT EXISTS cart_items (user_id INTEGER REFERENCES users(id), prompt_id INTEGER REFERENCES prompts(id), quantity INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, PRIMARY KEY(user_id,prompt_id));
    CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), status TEXT NOT NULL, subtotal REAL NOT NULL, fee REAL NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER REFERENCES orders(id), prompt_id INTEGER REFERENCES prompts(id), creator_id INTEGER REFERENCES creators(id), price REAL NOT NULL, quantity INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_prompts_catalog ON prompts(model, category_id, featured, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
  `)
}

function seed(db: DatabaseSync) {
  const count = db.prepare('SELECT COUNT(*) count FROM prompts').get() as { count: number }
  if (count.count) return
  db.exec('BEGIN')
  try {
    const catInsert = db.prepare('INSERT INTO categories(name) VALUES (?)')
    categories.forEach((name) => catInsert.run(name))
    const creatorInsert = db.prepare('INSERT INTO creators(name,handle,joined_at) VALUES (?,?,?)')
    creators.forEach((name, i) => creatorInsert.run(name, '@' + name.toLowerCase().replace(/[^a-z0-9]+/g, ''), `2025-${String((i % 9) + 1).padStart(2,'0')}-12`))
    db.prepare("INSERT INTO users(id,name,email) VALUES (1,'Alex Morgan','alex@powerprompt.local')").run()
    const promptInsert = db.prepare(`INSERT INTO prompts(id,slug,title,model,category_id,creator_id,price,sold,views,rating,aspect,description,prompt_text,image_url,featured,created_at)
      VALUES (?,?,?,?,(SELECT id FROM categories WHERE name=?),(SELECT id FROM creators WHERE name=?),?,?,?,?,?,?,?,?,?,?)`)
    promptSeeds.forEach((p, i) => {
      const seller = creators[i % creators.length]
      const [id,slug,title,model,price,sold,views,rating,cat,aspect,description,promptText] = p
      promptInsert.run(id,slug,title,model,cat,seller,price,sold,views,rating,aspect,description,promptText,`/media/prompt-${id}.jpg`,i < 8 ? 1 : 0,`2026-${String((i % 6) + 1).padStart(2,'0')}-${String((i * 3 % 26) + 1).padStart(2,'0')}`)
    })
    db.prepare("INSERT INTO favorites VALUES (1,207,'2026-07-01'),(1,101,'2026-07-02')").run()
    db.prepare("INSERT INTO cart_items VALUES (1,142,1,'2026-07-10')").run()
    const orderInsert = db.prepare("INSERT INTO orders(user_id,status,subtotal,fee,total,created_at) VALUES (1,'paid',?,?,?,?)")
    const itemInsert = db.prepare('INSERT INTO order_items(order_id,prompt_id,creator_id,price,quantity) SELECT ?,id,creator_id,price,1 FROM prompts WHERE id=?')
    const historicIds = [207,233,301,118,160,211,31,248,156,101,290,77]
    historicIds.forEach((promptId, i) => {
      const priceRow = db.prepare('SELECT price FROM prompts WHERE id=?').get(promptId) as { price: number }
      const fee = Math.round(priceRow.price * 0.06 * 100) / 100
      const date = new Date(Date.UTC(2026, 6, 1 + (i % 12))).toISOString()
      const result = orderInsert.run(priceRow.price,fee,priceRow.price + fee,date)
      itemInsert.run(Number(result.lastInsertRowid),promptId)
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const promptSelect = `SELECT p.id,p.slug,p.title,p.model,c.name category,p.price,p.sold,p.views,p.rating,cr.name seller,
  p.creator_id creatorId,p.aspect,p.description,p.prompt_text promptText,p.image_url imageUrl,p.featured,p.created_at createdAt,
  EXISTS(SELECT 1 FROM favorites f WHERE f.prompt_id=p.id AND f.user_id=1) isFavorite,
  ROUND((p.rating * 20) + LOG(p.sold + 1) * 8 + p.featured * 12, 2) rankScore
  FROM prompts p JOIN categories c ON c.id=p.category_id JOIN creators cr ON cr.id=p.creator_id`

export function listCatalog(db: DatabaseSync, filters: CatalogFilters = {}): CatalogData {
  const where: string[] = []
  const values: Array<string | number> = []
  if (filters.model && filters.model !== 'all') { where.push('p.model = ?'); values.push(filters.model) }
  if (filters.category && filters.category !== 'all') { where.push('c.name = ?'); values.push(filters.category) }
  if (filters.term) { where.push('(LOWER(p.title || p.description || p.model || c.name) LIKE ?)'); values.push(`%${filters.term.toLowerCase()}%`) }
  if (filters.favorites) where.push('EXISTS(SELECT 1 FROM favorites fx WHERE fx.prompt_id=p.id AND fx.user_id=1)')
  if (filters.free) where.push('p.price = 0')
  const sort = filters.sort === 'newest' ? 'p.created_at DESC, p.id DESC' : filters.sort === 'popular' ? 'p.rating DESC, p.sold DESC' : 'rankScore DESC, p.sold DESC'
  const prompts = db.prepare(`${promptSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${sort}`).all(...values) as unknown as Prompt[]
  const categoriesRows = db.prepare('SELECT c.name, COUNT(p.id) count FROM categories c LEFT JOIN prompts p ON p.category_id=c.id GROUP BY c.id ORDER BY c.id').all() as Array<{name:string;count:number}>
  const counts = db.prepare(`SELECT COUNT(*) allCount, SUM(featured) featured, SUM(price=0) free,
    (SELECT COUNT(*) FROM favorites WHERE user_id=1) favorites FROM prompts`).get() as {allCount:number;featured:number;free:number;favorites:number}
  const cart = db.prepare('SELECT COALESCE(SUM(quantity),0) count FROM cart_items WHERE user_id=1').get() as {count:number}
  return { prompts, categories: categoriesRows, counts: { all: counts.allCount, featured: counts.featured, free: counts.free, favorites: counts.favorites }, cartCount: cart.count }
}

export function getPromptBySlug(db: DatabaseSync, slugOrId: string) {
  return db.prepare(`${promptSelect} WHERE p.slug=? OR CAST(p.id AS TEXT)=?`).get(slugOrId, slugOrId) as Prompt | undefined
}

export function toggleFavorite(db: DatabaseSync, promptId: number) {
  const exists = db.prepare('SELECT 1 found FROM favorites WHERE user_id=1 AND prompt_id=?').get(promptId)
  if (exists) db.prepare('DELETE FROM favorites WHERE user_id=1 AND prompt_id=?').run(promptId)
  else db.prepare("INSERT INTO favorites VALUES (1,?,datetime('now'))").run(promptId)
  return { favorite: !exists, count: (db.prepare('SELECT COUNT(*) count FROM favorites WHERE user_id=1').get() as {count:number}).count }
}

export function addToCart(db: DatabaseSync, promptId: number) {
  db.prepare("INSERT INTO cart_items(user_id,prompt_id,quantity,created_at) VALUES (1,?,1,datetime('now')) ON CONFLICT(user_id,prompt_id) DO UPDATE SET quantity=1").run(promptId)
  return getCart(db)
}

export function removeFromCart(db: DatabaseSync, promptId: number) {
  db.prepare('DELETE FROM cart_items WHERE user_id=1 AND prompt_id=?').run(promptId)
  return getCart(db)
}

export function getCart(db: DatabaseSync): CartData {
  const items = db.prepare(`${promptSelect} JOIN cart_items ci ON ci.prompt_id=p.id WHERE ci.user_id=1 ORDER BY ci.created_at DESC`).all() as unknown as CartData['items']
  items.forEach((item) => { item.quantity = 1 })
  const row = db.prepare(`SELECT COALESCE(SUM(p.price * ci.quantity),0) subtotal, COALESCE(SUM(ci.quantity),0) count FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id WHERE ci.user_id=1`).get() as {subtotal:number;count:number}
  const subtotal = Math.round(row.subtotal * 100) / 100
  const fee = Math.round(subtotal * 0.06 * 100) / 100
  return { items, subtotal, fee, total: Math.round((subtotal + fee) * 100) / 100, count: row.count }
}

export function checkout(db: DatabaseSync) {
  const cart = getCart(db)
  if (!cart.count) throw new Error('Your cart is empty')
  db.exec('BEGIN')
  try {
    const result = db.prepare("INSERT INTO orders(user_id,status,subtotal,fee,total,created_at) VALUES (1,'paid',?,?,?,datetime('now'))").run(cart.subtotal,cart.fee,cart.total)
    const orderId = Number(result.lastInsertRowid)
    db.prepare(`INSERT INTO order_items(order_id,prompt_id,creator_id,price,quantity)
      SELECT ?,p.id,p.creator_id,p.price,ci.quantity FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id WHERE ci.user_id=1`).run(orderId)
    db.prepare('DELETE FROM cart_items WHERE user_id=1').run()
    db.exec('COMMIT')
    return { orderId, ...cart }
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

export function getAnalytics(db: DatabaseSync) {
  const overview = db.prepare(`SELECT ROUND(COALESCE(SUM(total),0),2) grossRevenue, COUNT(*) orders,
    ROUND(COALESCE(AVG(total),0),2) averageOrderValue FROM orders WHERE status='paid'`).get() as { grossRevenue:number; orders:number; averageOrderValue:number }
  const views = (db.prepare('SELECT SUM(views) views, SUM(sold) sales FROM prompts').get() as {views:number;sales:number})
  const creators = db.prepare(`SELECT cr.id,cr.name,
    (SELECT COUNT(*) FROM prompts p WHERE p.creator_id=cr.id) prompts,
    (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.creator_id=cr.id) sales,
    ROUND((SELECT COALESCE(SUM(oi.price*oi.quantity)*.85,0) FROM order_items oi WHERE oi.creator_id=cr.id),2) revenue,
    ROUND(COALESCE((SELECT SUM(p.sold)*100.0/NULLIF(SUM(p.views),0) FROM prompts p WHERE p.creator_id=cr.id),0),2) conversionRate
    FROM creators cr ORDER BY revenue DESC, sales DESC LIMIT 8`).all() as unknown as Array<{id:number;name:string;prompts:number;sales:number;revenue:number;conversionRate:number}>
  const categories = db.prepare(`SELECT c.name,COUNT(DISTINCT p.id) prompts,COALESCE(SUM(oi.quantity),0) sales,
    ROUND(COALESCE(SUM(oi.price*oi.quantity),0),2) revenue FROM categories c LEFT JOIN prompts p ON p.category_id=c.id LEFT JOIN order_items oi ON oi.prompt_id=p.id GROUP BY c.id ORDER BY revenue DESC`).all() as unknown as Array<{name:string;prompts:number;sales:number;revenue:number}>
  const daily = db.prepare(`WITH RECURSIVE days(day) AS (SELECT date('2026-07-01') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day < date('2026-07-14'))
    SELECT day,COUNT(o.id) orders,ROUND(COALESCE(SUM(o.total),0),2) revenue FROM days LEFT JOIN orders o ON date(o.created_at)=day GROUP BY day ORDER BY day`).all() as unknown as Array<{day:string;orders:number;revenue:number}>
  return { overview: { ...overview, conversionRate: Math.round(views.sales * 10000 / views.views) / 100 }, creators, categories, daily }
}
