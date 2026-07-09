import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import type { CartSummary, CatalogFilters, PromptCard } from './schema'

type MoneySummary = { revenueCents: number; orders: number; averageOrderValueCents: number; conversionRate: number }
type CreatorRevenue = { creator: string; revenueCents: number; sales: number }
type CategoryRevenue = { category: string; revenueCents: number; sales: number }
type DailyTrend = { day: string; sessions: number; revenueCents: number; orders: number; conversionRate: number }

const root = process.cwd()
const dataDir = path.join(root, 'data')
const dbPath = process.env.POWERPROMPT_DB ?? path.join(dataDir, process.env.NODE_ENV === 'test' ? `powerprompt-test-${process.pid}.sqlite` : 'powerprompt.sqlite')

let db: Database.Database | undefined

function image(seed: string) {
  return `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=1200&q=82`
}

export function getDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  if (!db) {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    migrate(db)
    seed(db)
  }
  return db
}

export function resetForTests() {
  db?.close()
  db = undefined
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
  const wal = `${dbPath}-wal`
  const shm = `${dbPath}-shm`
  if (fs.existsSync(wal)) fs.rmSync(wal)
  if (fs.existsSync(shm)) fs.rmSync(shm)
}

function migrate(conn: Database.Database) {
  conn.exec(`
    create table if not exists creators(id integer primary key, name text not null, handle text not null, commission_rate real not null);
    create table if not exists categories(id integer primary key, name text not null unique, color text not null);
    create table if not exists prompts(
      id integer primary key, slug text not null unique, title text not null, model text not null,
      category_id integer not null references categories(id), creator_id integer not null references creators(id),
      price_cents integer not null, sold integer not null, rating real not null, aspect_ratio text not null,
      image text not null, description text not null, featured integer not null, created_at text not null
    );
    create table if not exists users(id integer primary key, name text not null);
    create table if not exists favorites(user_id integer not null, prompt_id integer not null, primary key(user_id,prompt_id));
    create table if not exists cart_items(user_id integer not null, prompt_id integer not null, primary key(user_id,prompt_id));
    create table if not exists orders(id integer primary key, user_id integer not null, subtotal_cents integer not null, fees_cents integer not null, total_cents integer not null, created_at text not null);
    create table if not exists order_items(order_id integer not null, prompt_id integer not null, price_cents integer not null);
    create table if not exists visits(day text primary key, sessions integer not null, prompt_views integer not null);
  `)
}

function seed(conn: Database.Database) {
  const existing = conn.prepare('select count(*) as count from prompts').get() as { count: number }
  if (existing.count) return
  const tx = conn.transaction(() => {
    const creators = [['Atlas Studio','atlas',0.82],['Lumen','lumen',0.8],['Ops Guild','ops-guild',0.76],['Field & Co.','field-co',0.78],['Sumi Lab','sumi',0.81],['Marta Vey','marta',0.77]]
    creators.forEach((c, i) => conn.prepare('insert into creators values(?,?,?,?)').run(i + 1, ...c))
    const categories = [['Image','#c9fa46'],['Photography','#d8d0c2'],['Design','#f2a65a'],['Writing','#b8b0ff'],['Code','#9bd8ff'],['Marketing','#ffb2c4'],['Productivity','#b7e4c7'],['Research','#ffd166']]
    categories.forEach((c, i) => conn.prepare('insert into categories values(?,?,?)').run(i + 1, ...c))
    const prompts = [
      [207,'cinematic-still-35mm','Cinematic Still, 35mm','Midjourney',1,1,900,4700,5.0,'3/4',image('photo-1516035069371-29a1b244cc32'),'Film-grade stills with real lens language, grain, focal length, and cinema-ready light.',1,'2026-06-27'],
      [233,'ink-wash-warrior','Ink Wash Warrior','Midjourney',1,5,1200,2100,4.9,'2/3',image('photo-1549880338-65ddcdfd017b'),'Sumi-e meets splash ink with controlled negative space and dramatic monochrome figures.',1,'2026-06-22'],
      [174,'editorial-photo-grade','Editorial Photo Grade','Flux',2,2,1100,1300,4.9,'3/4',image('photo-1492691527719-9d1e07e534b4'),'Magazine-style color grading with warm skin, deep shadows, and a quiet print look.',1,'2026-06-30'],
      [301,'magazine-cover-maker','Magazine Cover Maker','GPT-4o',3,4,1400,3300,4.8,'4/5',image('photo-1500530855697-b586d89ba3ee'),'Turns a source photo into a full editorial cover system with precise layout notes.',1,'2026-07-04'],
      [118,'studio-portrait-soft-light','Studio Portrait, Soft Light','Flux',2,2,1000,1800,4.9,'4/5',image('photo-1508214751196-bcfd4ca60f91'),'Clean beauty light with believable falloff and skin texture that looks photographed.',1,'2026-06-26'],
      [198,'logo-sketch-monoline','Logo Sketch, Mono-line','Midjourney',3,1,1300,980,4.8,'1/1',image('photo-1455390582262-044cdead277a'),'Single-weight line marks with real negative-space thinking and vector-ready directions.',0,'2026-06-10'],
      [142,'cold-email-closer','The Cold-Email Closer','GPT-4o',6,6,1200,2300,4.9,'4/3',image('photo-1497366754035-f200968a6e72'),'Cold emails that get replies with a tested four-line structure and subject variants.',1,'2026-07-01'],
      [160,'senior-code-reviewer','Senior Code Reviewer','Claude',5,3,1800,1100,4.8,'1/1',image('photo-1515879218367-8466d910aaa4'),'Reviews diffs like a staff engineer, catching risk, edge cases, and maintenance debt.',1,'2026-06-18'],
      [267,'dreamy-bokeh-portrait','Dreamy Bokeh Portrait','Flux',2,2,1000,1700,4.8,'4/5',image('photo-1487412720507-e7ab37603c6f'),'Creamy backgrounds, golden-hour warmth, and razor-focused eyes with controlled mood.',0,'2026-06-14'],
      [101,'meeting-to-memo','Meeting -> Memo','Claude',7,3,600,5100,4.7,'4/3',image('photo-1552664730-d307ca884978'),'Turns messy transcripts into crisp decision memos with owners, dates, and risks.',1,'2026-07-03'],
      [290,'concept-car-studio','Concept Car, Studio','Midjourney',1,1,1200,1400,4.8,'3/2',image('photo-1492144534655-ae79c964c9d7'),'Automotive design renders with believable studio reflections and real scale.',0,'2026-06-20'],
      [77,'plot-doctor','The Plot Doctor','Claude',4,3,1600,1400,4.9,'1/1',image('photo-1455885666463-9b7c7e6f5b26'),'Diagnoses why a story stalls and prescribes fixes for stakes, pacing, and scenes.',0,'2026-05-30'],
      [221,'watercolor-cityscape','Watercolor Cityscape','Flux',1,5,900,2000,4.9,'3/4',image('photo-1518005020951-eccb494ad742'),'Loose luminous washes with confident linework, soft skies, and busy streets.',0,'2026-06-11'],
      [63,'inbox-zero-strategist','Inbox Zero Strategist','Claude',7,3,0,3400,4.6,'4/3',image('photo-1483058712412-4245e9b90334'),'Triage, draft, and schedule a full inbox in one pass by urgency and leverage.',1,'2026-07-02'],
      [88,'research-brief-builder','Research Brief Builder','GPT-4o',8,4,700,900,4.7,'3/2',image('photo-1454165804606-c3d57bc86b40'),'Produces structured source briefs with claims, citations, contradictions, and gaps.',0,'2026-06-16']
    ]
    prompts.forEach((p) => conn.prepare('insert into prompts values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...p))
    conn.prepare('insert into users values(?,?)').run(1, 'Demo buyer')
    ;[207,301,63].forEach((id) => conn.prepare('insert into favorites values(?,?)').run(1, id))
    ;[207,63].forEach((id) => conn.prepare('insert into cart_items values(?,?)').run(1, id))
    const orders = [[1,1,2700,216,2916,'2026-07-01'],[2,1,2400,192,2592,'2026-07-02'],[3,1,4300,344,4644,'2026-07-03'],[4,1,1800,144,1944,'2026-07-04']]
    orders.forEach((o) => conn.prepare('insert into orders values(?,?,?,?,?,?)').run(...o))
    ;[[1,207,900],[1,142,1200],[1,63,0],[2,301,1400],[2,118,1000],[3,160,1800],[3,77,1600],[3,88,700],[4,233,1200],[4,101,600]].forEach((i) => conn.prepare('insert into order_items values(?,?,?)').run(...i))
    ;[['2026-07-01',120,420],['2026-07-02',138,510],['2026-07-03',160,570],['2026-07-04',142,490],['2026-07-05',151,530]].forEach((v) => conn.prepare('insert into visits values(?,?,?)').run(...v))
  })
  tx()
}

const promptSelect = `p.id,p.title,p.slug,p.model,c.name as category,cr.name as creator,p.price_cents as priceCents,p.sold,p.rating,p.aspect_ratio as aspectRatio,p.image,p.description,p.featured,p.created_at as createdAt,case when f.prompt_id is null then 0 else 1 end as isFavorite,case when ci.prompt_id is null then 0 else 1 end as inCart,round((p.rating*24)+(log(p.sold+1)*16)+(p.featured*28)-(p.price_cents/250.0),2) as rankScore`

export function listPrompts(filters: CatalogFilters = {}): PromptCard[] {
  const conn = getDb()
  const params: Record<string, unknown> = { userId: filters.userId ?? 1, term: `%${filters.term ?? ''}%` }
  const where = ["(:term = '%%' or p.title like :term or p.description like :term or cr.name like :term)"]
  if (filters.model && filters.model !== 'All') { where.push('p.model = :model'); params.model = filters.model }
  if (filters.category && filters.category !== 'All') { where.push('c.name = :category'); params.category = filters.category }
  if (filters.favoritesOnly) where.push('f.prompt_id is not null')
  if (filters.price === 'free') where.push('p.price_cents = 0')
  if (filters.price === 'paid') where.push('p.price_cents > 0')
  const order = filters.sort === 'Newest' ? 'p.created_at desc, p.id desc' : filters.sort === 'Popular' ? 'p.sold desc, p.rating desc' : 'rankScore desc, p.created_at desc'
  return conn.prepare(`select ${promptSelect} from prompts p join categories c on c.id=p.category_id join creators cr on cr.id=p.creator_id left join favorites f on f.prompt_id=p.id and f.user_id=:userId left join cart_items ci on ci.prompt_id=p.id and ci.user_id=:userId where ${where.join(' and ')} order by ${order}`).all(params) as PromptCard[]
}

export function getPrompt(slug: string, userId = 1) {
  return getDb().prepare(`select ${promptSelect} from prompts p join categories c on c.id=p.category_id join creators cr on cr.id=p.creator_id left join favorites f on f.prompt_id=p.id and f.user_id=? left join cart_items ci on ci.prompt_id=p.id and ci.user_id=? where p.slug=?`).get(userId, userId, slug) as PromptCard | undefined
}

export function toggleFavorite(promptId: number, userId = 1) {
  const conn = getDb()
  const row = conn.prepare('select 1 from favorites where user_id=? and prompt_id=?').get(userId, promptId)
  if (row) conn.prepare('delete from favorites where user_id=? and prompt_id=?').run(userId, promptId)
  else conn.prepare('insert or ignore into favorites values(?,?)').run(userId, promptId)
  return { favorite: !row }
}

export function addToCart(promptId: number, userId = 1) {
  getDb().prepare('insert or ignore into cart_items values(?,?)').run(userId, promptId)
  return getCartSummary(userId)
}

export function removeFromCart(promptId: number, userId = 1) {
  getDb().prepare('delete from cart_items where user_id=? and prompt_id=?').run(userId, promptId)
  return getCartSummary(userId)
}

export function getCartSummary(userId = 1): CartSummary {
  const items = listPrompts({ userId }).filter((p) => p.inCart)
  const subtotalCents = Number((getDb().prepare('select coalesce(sum(p.price_cents),0) as total from cart_items ci join prompts p on p.id=ci.prompt_id where ci.user_id=?').get(userId) as { total: number }).total)
  const feesCents = Math.round(subtotalCents * 0.08)
  return { items, subtotalCents, feesCents, totalCents: subtotalCents + feesCents, freeCount: items.filter((i) => i.priceCents === 0).length, paidCount: items.filter((i) => i.priceCents > 0).length }
}

export function checkout(userId = 1) {
  const conn = getDb()
  const cart = getCartSummary(userId)
  if (!cart.items.length) return { ok: false, orderId: null, cart }
  const id = Number((conn.prepare('select coalesce(max(id),0)+1 as id from orders').get() as { id: number }).id)
  const today = new Date().toISOString().slice(0, 10)
  const tx = conn.transaction(() => {
    conn.prepare('insert into orders values(?,?,?,?,?,?)').run(id, userId, cart.subtotalCents, cart.feesCents, cart.totalCents, today)
    cart.items.forEach((p) => conn.prepare('insert into order_items values(?,?,?)').run(id, p.id, p.priceCents))
    conn.prepare('delete from cart_items where user_id=?').run(userId)
  })
  tx()
  return { ok: true, orderId: id, cart: getCartSummary(userId) }
}

export function getCounts(userId = 1) {
  return getDb().prepare(`select (select count(*) from prompts where price_cents=0) as freeCount,(select count(*) from prompts where price_cents>0) as paidCount,(select count(*) from favorites where user_id=?) as favorites,(select count(*) from cart_items where user_id=?) as cart`).get(userId, userId) as { freeCount: number; paidCount: number; favorites: number; cart: number }
}

export function getAnalytics() {
  const conn = getDb()
  const creatorRevenue = conn.prepare(`select cr.name as creator, round(sum(oi.price_cents*cr.commission_rate)) as revenueCents, count(*) as sales from order_items oi join prompts p on p.id=oi.prompt_id join creators cr on cr.id=p.creator_id group by cr.id order by revenueCents desc`).all() as CreatorRevenue[]
  const categoryRevenue = conn.prepare(`select c.name as category, sum(oi.price_cents) as revenueCents, count(*) as sales from order_items oi join prompts p on p.id=oi.prompt_id join categories c on c.id=p.category_id group by c.id order by revenueCents desc`).all() as CategoryRevenue[]
  const summary = conn.prepare(`select sum(total_cents) as revenueCents, count(*) as orders, round(avg(total_cents)) as averageOrderValueCents, round((count(*)*100.0)/(select sum(sessions) from visits),2) as conversionRate from orders`).get() as MoneySummary
  const daily = conn.prepare(`select v.day, v.sessions, coalesce(sum(o.total_cents),0) as revenueCents, count(o.id) as orders, round((count(o.id)*100.0)/v.sessions,2) as conversionRate from visits v left join orders o on o.created_at=v.day group by v.day order by v.day`).all() as DailyTrend[]
  return { summary, creatorRevenue, categoryRevenue, daily }
}
