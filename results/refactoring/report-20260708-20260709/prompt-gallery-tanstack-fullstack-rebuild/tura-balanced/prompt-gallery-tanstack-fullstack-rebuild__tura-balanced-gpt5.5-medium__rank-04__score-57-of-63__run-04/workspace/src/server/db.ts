import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { categories, creators, prompts, userId } from './seed'

export type DbPrompt = (typeof prompts)[number] & { slug: string; imageUrl: string; createdAt: string }
export type DbState = {
  users: Array<{ id: number; email: string }>
  creators: typeof creators
  categories: Array<{ id: number; name: string }>
  prompts: Array<DbPrompt>
  favorites: Array<{ userId: number; promptId: number }>
  cartItems: Array<{ userId: number; promptId: number; quantity: number }>
  orders: Array<{ id: number; userId: number; createdAt: string; subtotal: number; fees: number; total: number }>
  orderItems: Array<{ orderId: number; promptId: number; price: number; creatorId: number; categoryId: number }>
  sessions: Array<{ userId: number; createdAt: string; converted: number }>
}

const defaultPath = resolve(process.cwd(), 'data', 'powerprompt.json')

export function createConnection(path = process.env.POWERPROMPT_DB_PATH ?? defaultPath) {
  mkdirSync(dirname(path), { recursive: true })
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(seedState(), null, 2))
  return new FileDb(path)
}

export class FileDb {
  constructor(private readonly path: string) {}
  read(): DbState {
    return JSON.parse(readFileSync(this.path, 'utf-8')) as DbState
  }
  write(state: DbState) {
    writeFileSync(this.path, JSON.stringify(state, null, 2))
  }
  transaction<T>(fn: (state: DbState) => T) {
    const state = this.read()
    const result = fn(state)
    this.write(state)
    return result
  }
}

export type AppDb = FileDb

let singleton: AppDb | undefined

export function getDb() {
  singleton ??= createConnection()
  return singleton
}

function seedState(): DbState {
  const categoryRows = categories.map((name, index) => ({ id: index + 1, name }))
  const dbPrompts = prompts.map((prompt, index) => {
    const [w, h] = prompt.aspectRatio.split('/').map(Number)
    const width = 720
    const height = Math.round((width * h) / w)
    return {
      ...prompt,
      slug: prompt.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      imageUrl: `https://picsum.photos/seed/pp${prompt.id}/${width}/${height}`,
      createdAt: new Date(Date.UTC(2026, 5, 1 + index)).toISOString(),
    }
  })
  const orderDefs = [
    { id: 1, day: '2026-06-01', items: [207, 31, 101] },
    { id: 2, day: '2026-06-02', items: [301, 142] },
    { id: 3, day: '2026-06-03', items: [211, 255, 276] },
    { id: 4, day: '2026-06-04', items: [160, 156] },
    { id: 5, day: '2026-06-05', items: [189, 63, 77] },
    { id: 6, day: '2026-06-06', items: [248, 221, 118] },
  ]
  const orders: DbState['orders'] = []
  const orderItems: DbState['orderItems'] = []
  for (const order of orderDefs) {
    const items = order.items.map((id) => dbPrompts.find((prompt) => prompt.id === id)!).filter(Boolean)
    const subtotal = items.reduce((sum, prompt) => sum + prompt.price, 0)
    const fees = Math.round(subtotal * 0.08 * 100) / 100
    orders.push({ id: order.id, userId, createdAt: `${order.day}T12:00:00.000Z`, subtotal, fees, total: subtotal + fees })
    items.forEach((prompt) => orderItems.push({ orderId: order.id, promptId: prompt.id, price: prompt.price, creatorId: prompt.creatorId, categoryId: categoryRows.find((row) => row.name === prompt.category)!.id }))
  }
  return {
    users: [{ id: userId, email: 'maker@powerprompt.local' }],
    creators,
    categories: categoryRows,
    prompts: dbPrompts,
    favorites: [207, 31, 101, 211].map((promptId) => ({ userId, promptId })),
    cartItems: [142, 276].map((promptId) => ({ userId, promptId, quantity: 1 })),
    orders,
    orderItems,
    sessions: Array.from({ length: 40 }, (_, index) => ({ userId, createdAt: `2026-06-${String((index % 8) + 1).padStart(2, '0')}T09:00:00.000Z`, converted: index < 14 ? 1 : 0 })),
  }
}
