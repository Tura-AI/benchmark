export type ModelName = 'GPT-4o' | 'Claude' | 'Midjourney' | 'Flux'
export type SortName = 'featured' | 'newest' | 'popular'

export type Creator = {
  id: number
  name: string
  handle: string
  studio: string
}

export type Category = {
  id: number
  name: string
}

export type Prompt = {
  id: number
  title: string
  model: ModelName
  categoryId: number
  creatorId: number
  price: number
  sold: number
  rating: number
  aspect: string
  description: string
  image: string
  createdAt: string
  featured: boolean
}

export type User = {
  id: number
  name: string
}

export type CartRow = {
  userId: number
  promptId: number
  quantity: number
}

export type FavoriteRow = {
  userId: number
  promptId: number
}

export type Order = {
  id: number
  userId: number
  createdAt: string
  subtotal: number
  fee: number
  total: number
}

export type OrderItem = {
  orderId: number
  promptId: number
  price: number
  creatorId: number
  categoryId: number
}

export type PromptCard = Prompt & {
  category: string
  creator: string
  handle: string
  isFavorite: boolean
  inCart: boolean
  rankScore: number
}

export type CartSummary = {
  items: Array<PromptCard & { quantity: number; lineTotal: number }>
  count: number
  subtotal: number
  fee: number
  total: number
}

export type StorefrontData = {
  prompts: PromptCard[]
  categories: Category[]
  counts: {
    total: number
    free: number
    paid: number
    featured: number
    favorites: number
    cart: number
  }
  active: {
    model: string
    category: string
    sort: SortName
    q: string
    favorites: boolean
  }
  cart: CartSummary
}

export type Analytics = {
  creatorRevenue: Array<{
    creatorId: number
    creator: string
    prompts: number
    units: number
    revenue: number
    conversionRate: number
  }>
  categoryRevenue: Array<{ category: string; units: number; revenue: number }>
  dailySales: Array<{ date: string; orders: number; revenue: number }>
  trend: Array<{ date: string; revenue: number; change: number }>
  averageOrderValue: number
  conversionRate: number
  totalRevenue: number
  orderCount: number
}

export type DatabaseShape = {
  creators: Creator[]
  categories: Category[]
  prompts: Prompt[]
  users: User[]
  cart: CartRow[]
  favorites: FavoriteRow[]
  orders: Order[]
  orderItems: OrderItem[]
  visits: number
}
