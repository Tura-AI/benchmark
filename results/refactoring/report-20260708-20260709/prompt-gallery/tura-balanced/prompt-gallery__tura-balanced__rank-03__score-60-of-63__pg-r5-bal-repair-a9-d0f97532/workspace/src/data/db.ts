import * as fs from 'node:fs'
import * as path from 'node:path'
import { defaultUserId, seedDatabase } from './seed'
import type {
  Analytics,
  CartSummary,
  DatabaseShape,
  PromptCard,
  SortName,
  StorefrontData,
} from './types'

const dataDir = path.join(process.cwd(), 'data')
const dbPath = path.join(dataDir, 'powerprompt.db.json')
const platformFeeRate = 0.08

export type CatalogQuery = {
  model?: string
  category?: string
  sort?: SortName
  q?: string
  favorites?: boolean
  free?: boolean
}

function cloneSeed(): DatabaseShape {
  return JSON.parse(JSON.stringify(seedDatabase)) as DatabaseShape
}

export function resetDatabase() {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(dbPath, JSON.stringify(cloneSeed(), null, 2))
}

export function readDatabase(): DatabaseShape {
  if (!fs.existsSync(dbPath)) resetDatabase()
  const raw = fs.readFileSync(dbPath, 'utf8')
  return JSON.parse(raw) as DatabaseShape
}

function writeDatabase(db: DatabaseShape) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2))
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function rankScore(prompt: { sold: number; rating: number; featured: boolean; createdAt: string }) {
  const ageDays = Math.max(1, (Date.now() - Date.parse(prompt.createdAt)) / 86_400_000)
  const recency = 100 / ageDays
  return roundMoney(prompt.sold * 0.68 + prompt.rating * 120 + recency + (prompt.featured ? 240 : 0))
}

function promptCards(db: DatabaseShape, userId = defaultUserId): PromptCard[] {
  const favorites = new Set(db.favorites.filter((row) => row.userId === userId).map((row) => row.promptId))
  const cart = new Set(db.cart.filter((row) => row.userId === userId).map((row) => row.promptId))

  return db.prompts.map((prompt) => {
    const category = db.categories.find((item) => item.id === prompt.categoryId)
    const creator = db.creators.find((item) => item.id === prompt.creatorId)
    if (!category || !creator) throw new Error(`Prompt ${prompt.id} has broken seed relations`)

    return {
      ...prompt,
      category: category.name,
      creator: creator.name,
      handle: creator.handle,
      isFavorite: favorites.has(prompt.id),
      inCart: cart.has(prompt.id),
      rankScore: rankScore(prompt),
    }
  })
}

function sortPrompts(rows: PromptCard[], sort: SortName) {
  const sorted = [...rows]
  if (sort === 'newest') sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  if (sort === 'popular') sorted.sort((a, b) => b.rating - a.rating || b.sold - a.sold)
  if (sort === 'featured') sorted.sort((a, b) => b.rankScore - a.rankScore)
  return sorted
}

export function getCartSummary(userId = defaultUserId, db = readDatabase()): CartSummary {
  const rows = promptCards(db, userId)
  const items = db.cart
    .filter((row) => row.userId === userId)
    .map((row) => {
      const prompt = rows.find((item) => item.id === row.promptId)
      if (!prompt) throw new Error(`Cart prompt ${row.promptId} is missing`)
      return { ...prompt, quantity: row.quantity, lineTotal: roundMoney(prompt.price * row.quantity) }
    })
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0))
  const fee = roundMoney(subtotal * platformFeeRate)
  return {
    items,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    fee,
    total: roundMoney(subtotal + fee),
  }
}

export function getStorefront(query: CatalogQuery = {}, userId = defaultUserId): StorefrontData {
  const db = readDatabase()
  const sort = query.sort ?? 'featured'
  const term = (query.q ?? '').trim().toLowerCase()
  let rows = promptCards(db, userId)

  if (query.model && query.model !== 'all') rows = rows.filter((prompt) => prompt.model === query.model)
  if (query.category && query.category !== 'all') rows = rows.filter((prompt) => prompt.category === query.category)
  if (query.free) rows = rows.filter((prompt) => prompt.price === 0)
  if (query.favorites) rows = rows.filter((prompt) => prompt.isFavorite)
  if (term) {
    rows = rows.filter((prompt) => `${prompt.title} ${prompt.model} ${prompt.category} ${prompt.description} ${prompt.creator}`.toLowerCase().includes(term))
  }

  const all = promptCards(db, userId)
  const cart = getCartSummary(userId, db)

  return {
    prompts: sortPrompts(rows, sort),
    categories: db.categories,
    counts: {
      total: all.length,
      free: all.filter((prompt) => prompt.price === 0).length,
      paid: all.filter((prompt) => prompt.price > 0).length,
      featured: all.filter((prompt) => prompt.featured).length,
      favorites: all.filter((prompt) => prompt.isFavorite).length,
      cart: cart.count,
    },
    active: {
      model: query.model ?? 'all',
      category: query.category ?? 'all',
      sort,
      q: query.q ?? '',
      favorites: Boolean(query.favorites),
    },
    cart,
  }
}

export function getPrompt(id: number, userId = defaultUserId) {
  const row = promptCards(readDatabase(), userId).find((prompt) => prompt.id === id)
  if (!row) throw new Error(`Prompt ${id} was not found`)
  return row
}

export function toggleFavorite(promptId: number, userId = defaultUserId) {
  const db = readDatabase()
  const exists = db.favorites.some((row) => row.userId === userId && row.promptId === promptId)
  db.favorites = exists
    ? db.favorites.filter((row) => !(row.userId === userId && row.promptId === promptId))
    : [...db.favorites, { userId, promptId }]
  writeDatabase(db)
  return { favorited: !exists, counts: getStorefront({}, userId).counts }
}

export function addToCart(promptId: number, userId = defaultUserId) {
  const db = readDatabase()
  if (!db.prompts.some((prompt) => prompt.id === promptId)) throw new Error(`Prompt ${promptId} was not found`)
  const existing = db.cart.find((row) => row.userId === userId && row.promptId === promptId)
  if (existing) existing.quantity += 1
  else db.cart.push({ userId, promptId, quantity: 1 })
  writeDatabase(db)
  return getCartSummary(userId)
}

export function removeFromCart(promptId: number, userId = defaultUserId) {
  const db = readDatabase()
  db.cart = db.cart.filter((row) => !(row.userId === userId && row.promptId === promptId))
  writeDatabase(db)
  return getCartSummary(userId)
}

export function checkout(userId = defaultUserId) {
  const db = readDatabase()
  const summary = getCartSummary(userId, db)
  if (!summary.items.length) throw new Error('Cart is empty')
  const id = Math.max(0, ...db.orders.map((order) => order.id)) + 1
  const createdAt = new Date().toISOString().slice(0, 10)
  db.orders.push({ id, userId, createdAt, subtotal: summary.subtotal, fee: summary.fee, total: summary.total })
  for (const item of summary.items) {
    db.orderItems.push({
      orderId: id,
      promptId: item.id,
      price: item.price,
      creatorId: item.creatorId,
      categoryId: item.categoryId,
    })
  }
  db.cart = db.cart.filter((row) => row.userId !== userId)
  writeDatabase(db)
  return { orderId: id, ...summary }
}

export function getAnalytics(): Analytics {
  const db = readDatabase()
  const totalRevenue = roundMoney(db.orders.reduce((sum, order) => sum + order.total, 0))
  const creatorRevenue = db.creators.map((creator) => {
    const items = db.orderItems.filter((item) => item.creatorId === creator.id)
    const prompts = db.prompts.filter((prompt) => prompt.creatorId === creator.id)
    const views = prompts.reduce((sum, prompt) => sum + prompt.sold, 0)
    return {
      creatorId: creator.id,
      creator: creator.name,
      prompts: prompts.length,
      units: items.length,
      revenue: roundMoney(items.reduce((sum, item) => sum + item.price, 0)),
      conversionRate: roundMoney((items.length / Math.max(1, views)) * 100),
    }
  }).sort((a, b) => b.revenue - a.revenue)

  const categoryRevenue = db.categories.map((category) => {
    const items = db.orderItems.filter((item) => item.categoryId === category.id)
    return {
      category: category.name,
      units: items.length,
      revenue: roundMoney(items.reduce((sum, item) => sum + item.price, 0)),
    }
  }).filter((row) => row.units > 0).sort((a, b) => b.revenue - a.revenue)

  const dailySales = [...new Set(db.orders.map((order) => order.createdAt))].sort().map((date) => {
    const orders = db.orders.filter((order) => order.createdAt === date)
    return { date, orders: orders.length, revenue: roundMoney(orders.reduce((sum, order) => sum + order.total, 0)) }
  })

  const trend = dailySales.map((row, index) => {
    const previous = dailySales[index - 1]?.revenue ?? row.revenue
    return { date: row.date, revenue: row.revenue, change: roundMoney(row.revenue - previous) }
  })

  return {
    creatorRevenue,
    categoryRevenue,
    dailySales,
    trend,
    averageOrderValue: roundMoney(totalRevenue / Math.max(1, db.orders.length)),
    conversionRate: roundMoney((db.orders.length / Math.max(1, db.visits)) * 100),
    totalRevenue,
    orderCount: db.orders.length,
  }
}

export function getDatabasePath() {
  return dbPath
}
