export type PromptCard = {
  id: number
  title: string
  model: string
  category: string
  price: number
  sold: number
  rating: number
  creatorId: number
  creator: string
  aspect: string
  featured: number
  createdAt: string
  description: string
  rankScore: number
  isFavorite: number
  inCart: number
  image: string
}

export type Toast = {
  text: string
  tone?: 'dark' | 'lime'
}
