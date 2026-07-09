export type Model = 'GPT-4o' | 'Claude' | 'Midjourney' | 'Flux';
export type SortMode = 'Featured' | 'Newest' | 'Popular';

export type PromptCard = {
  id: string;
  title: string;
  creator: string;
  category: string;
  model: Model;
  priceCents: number;
  rating: number;
  sales: number;
  image: string;
  ratio: string;
  featured: boolean;
  createdAt: string;
  isFavorite: boolean;
  inCart: boolean;
  description: string;
};

export type CatalogResponse = {
  prompts: PromptCard[];
  categories: { slug: string; name: string; count: number; freeCount: number; paidCount: number }[];
  models: Model[];
  counts: { all: number; free: number; paid: number; featured: number; favorites: number; cart: number };
};

export type CartSummary = {
  items: PromptCard[];
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
};

export type AnalyticsSummary = {
  creatorRevenue: { creator: string; revenueCents: number; sales: number; conversionRate: number; averageOrderValueCents: number }[];
  categoryRevenue: { category: string; revenueCents: number; units: number }[];
  dailySales: { day: string; revenueCents: number; orders: number }[];
  averagePriceCents: number;
};
