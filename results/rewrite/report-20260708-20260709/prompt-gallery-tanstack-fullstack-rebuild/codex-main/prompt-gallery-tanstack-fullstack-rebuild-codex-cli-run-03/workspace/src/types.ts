export type PromptCard = {
  id: number
  title: string
  model: string
  category: string
  creator: string
  creatorHandle: string
  price: number
  sold: number
  rating: number
  aspect: string
  description: string
  imageSeed: string
  featured: number
  createdAt: string
  favorite: number
  inCart: number
  rankScore: number
}

export type ShellData = {
  categories: Array<{ name: string; promptCount: number }>
  models: Array<{ model: string; promptCount: number }>
  counts: { total: number; free: number; paid: number; favorites: number; cart: number }
}
