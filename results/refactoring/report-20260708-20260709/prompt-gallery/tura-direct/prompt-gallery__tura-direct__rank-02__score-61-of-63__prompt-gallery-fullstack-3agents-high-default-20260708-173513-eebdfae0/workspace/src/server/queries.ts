import { z } from 'zod'
import { demoUserId } from './seed'
import type { Db } from './db'

export const CatalogInput = z.object({
  model: z.string().default('all'),
  category: z.string().default('all'),
  sort: z.enum(['Featured', 'Newest', 'Popular']).default('Featured'),
  search: z.string().default(''),
  favoritesOnly: z.boolean().default(false),
})

export type CatalogInput = z.infer<typeof CatalogInput>
const feeRate = 0.06

export function listCatalog(db: Db, raw: Partial<CatalogInput> = {}) {
  const input = CatalogInput.parse(raw)
  const where: string[] = []
  const params: Record<string, string | number> = { userId: demoUserId }
  if (input.model !== 'all') { where.push('p.model = @model'); params.model = input.model }
  if (input.category !== 'all') { where.push('p.category_id = @category'); params.category = input.category }
  if (input.search) { where.push('(p.title like @q or p.description like @q or p.tags like @q)'); params.q = `%${input.search}%` }
  if (input.favoritesOnly) where.push('f.prompt_id is not null')
  const orderBy = input.sort === 'Newest'
    ? 'date(p.created_at) desc, p.title asc'
    : input.sort === 'Popular'
      ? 'p.sales desc, p.rating desc, p.title asc'
      : 'rank_score desc, p.featured desc, p.title asc'
  const prompts = db.prepare(`
    select p.id, p.title, p.slug, p.model, p.price_cents as priceCents, p.featured, p.image, p.ratio,
      p.description, p.tags, p.sales, p.views, p.rating, p.created_at as createdAt,
      c.name as category, c.id as categoryId, cr.name as creator, cr.handle as creatorHandle,
      case when f.prompt_id is null then 0 else 1 end as favorite,
      case when ci.prompt_id is null then 0 else 1 end as inCart,
      round((p.sales * 1.35) + (p.rating * 28) + (p.views * .018) + case when p.featured=1 then 85 else 0 end - (p.price_cents / 900.0), 2) as rank_score
    from prompts p
    join categories c on c.id = p.category_id
    join creators cr on cr.id = p.creator_id
    left join favorites f on f.prompt_id = p.id and f.user_id = @userId
    left join cart_items ci on ci.prompt_id = p.id and ci.user_id = @userId
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by ${orderBy}
  `).all(params)
  const counts = db.prepare(`
    select
      count(*) as total,
      sum(case when featured=1 then 1 else 0 end) as featured,
      sum(case when price_cents=0 then 1 else 0 end) as free,
      sum(case when price_cents>0 then 1 else 0 end) as paid
    from prompts
  `).get()
  const models = db.prepare('select model, count(*) as count from prompts group by model order by model').all()
  const categories = db.prepare('select id, name, color, (select count(*) from prompts p where p.category_id = categories.id) as count from categories order by name').all()
  return { prompts, counts, models, categories }
}

export function getPrompt(db: Db, id: string) {
  return db.prepare(`
    select p.id, p.title, p.slug, p.model, p.price_cents as priceCents, p.featured, p.image, p.ratio, p.description,
      p.tags, p.sales, p.views, p.rating, p.created_at as createdAt, c.name as category, cr.name as creator,
      cr.handle as creatorHandle, cr.specialty as creatorSpecialty, cr.avatar as creatorAvatar,
      case when f.prompt_id is null then 0 else 1 end as favorite,
      case when ci.prompt_id is null then 0 else 1 end as inCart
    from prompts p
    join categories c on c.id = p.category_id
    join creators cr on cr.id = p.creator_id
    left join favorites f on f.prompt_id = p.id and f.user_id = ?
    left join cart_items ci on ci.prompt_id = p.id and ci.user_id = ?
    where p.id = ? or p.slug = ?
  `).get(demoUserId, demoUserId, id, id)
}

export function toggleFavorite(db: Db, promptId: string) {
  const existing = db.prepare('select 1 from favorites where user_id=? and prompt_id=?').get(demoUserId, promptId)
  if (existing) db.prepare('delete from favorites where user_id=? and prompt_id=?').run(demoUserId, promptId)
  else db.prepare('insert into favorites values (?, ?)').run(demoUserId, promptId)
  return { favorite: !existing, count: db.prepare('select count(*) as count from favorites where user_id=?').get(demoUserId) }
}

export function addToCart(db: Db, promptId: string) {
  db.prepare('insert into cart_items values (?, ?, 1) on conflict(user_id, prompt_id) do update set quantity=quantity+1').run(demoUserId, promptId)
  return getCart(db)
}

export function removeFromCart(db: Db, promptId: string) {
  db.prepare('delete from cart_items where user_id=? and prompt_id=?').run(demoUserId, promptId)
  return getCart(db)
}

export function getCart(db: Db) {
  const items = db.prepare(`
    select p.id, p.title, p.model, p.price_cents as priceCents, p.image, ci.quantity, cr.name as creator,
      (p.price_cents * ci.quantity) as lineTotalCents
    from cart_items ci join prompts p on p.id=ci.prompt_id join creators cr on cr.id=p.creator_id
    where ci.user_id=? order by p.title
  `).all(demoUserId)
  const totals = db.prepare(`
    select coalesce(sum(p.price_cents * ci.quantity),0) as subtotalCents,
      cast(round(coalesce(sum(p.price_cents * ci.quantity),0) * ?) as integer) as feeCents,
      coalesce(sum(p.price_cents * ci.quantity),0) + cast(round(coalesce(sum(p.price_cents * ci.quantity),0) * ?) as integer) as totalCents,
      count(*) as itemCount
    from cart_items ci join prompts p on p.id=ci.prompt_id where ci.user_id=?
  `).get(feeRate, feeRate, demoUserId)
  return { items, totals }
}

export function checkout(db: Db) {
  const cart = getCart(db) as any
  if (!cart.totals.itemCount) return { ok: false, orderId: null, cart }
  const orderId = `ord-${Date.now().toString(36)}`
  const now = new Date().toISOString().slice(0, 10)
  db.prepare('insert into orders values (?, ?, ?, ?, ?, ?, ?)').run(orderId, demoUserId, cart.totals.subtotalCents, cart.totals.feeCents, cart.totals.totalCents, 'paid', now)
  const insertItem = db.prepare('insert into order_items values (?, ?, ?)')
  const bumpSales = db.prepare('update prompts set sales=sales+? where id=?')
  for (const item of cart.items as any[]) {
    insertItem.run(orderId, item.id, item.priceCents)
    bumpSales.run(item.quantity, item.id)
  }
  db.prepare('delete from cart_items where user_id=?').run(demoUserId)
  return { ok: true, orderId, cart: getCart(db) }
}

export function analytics(db: Db) {
  const summary = db.prepare(`
    select count(*) as orders, coalesce(sum(total_cents),0) as grossCents,
      cast(round(coalesce(avg(total_cents),0)) as integer) as averageOrderValueCents,
      round((select count(*) from orders where status='paid') * 100.0 / nullif((select sum(views) from prompts),0), 3) as conversionRate
    from orders where status='paid'
  `).get()
  const creatorRevenue = db.prepare(`
    select cr.name, cr.handle, coalesce(sum(oi.price_cents),0) as revenueCents, count(oi.prompt_id) as sales
    from creators cr left join prompts p on p.creator_id=cr.id left join order_items oi on oi.prompt_id=p.id
    group by cr.id order by revenueCents desc
  `).all()
  const categoryRevenue = db.prepare(`
    select c.name, coalesce(sum(oi.price_cents),0) as revenueCents, count(oi.prompt_id) as sales
    from categories c left join prompts p on p.category_id=c.id left join order_items oi on oi.prompt_id=p.id
    group by c.id order by revenueCents desc
  `).all()
  const dailySales = db.prepare(`
    select created_at as day, count(*) as orders, sum(total_cents) as totalCents
    from orders where status='paid' group by created_at order by created_at
  `).all()
  return { summary, creatorRevenue, categoryRevenue, dailySales }
}
