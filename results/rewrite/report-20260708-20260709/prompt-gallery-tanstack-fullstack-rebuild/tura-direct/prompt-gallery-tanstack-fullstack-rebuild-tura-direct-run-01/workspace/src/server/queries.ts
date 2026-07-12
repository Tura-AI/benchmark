import { db, demoUserId } from './db';
import type { AnalyticsSummary, CartSummary, CatalogResponse, Model, PromptCard, SortMode } from '../types';

type PromptRow = {
  id: string; title: string; creator: string; category: string; model: Model; priceCents: number; rating: number; sales: number; image: string; ratio: string; featured: 0 | 1; createdAt: string; favorite: 0 | 1; carted: 0 | 1; description: string;
};

function mapPrompt(row: PromptRow): PromptCard {
  return { ...row, featured: row.featured === 1, isFavorite: row.favorite === 1, inCart: row.carted === 1 };
}

export function listCatalog(input: { model?: string; category?: string; sort?: SortMode; q?: string; favorites?: boolean } = {}): CatalogResponse {
  const model = input.model && input.model !== 'all' ? input.model : null;
  const category = input.category && input.category !== 'all' ? input.category : null;
  const q = input.q ? `%${input.q.toLowerCase()}%` : null;
  const sort = input.sort ?? 'Featured';
  const order = sort === 'Newest'
    ? 'p.created_at DESC, p.sales DESC'
    : sort === 'Popular'
      ? 'p.sales DESC, p.rating DESC'
      : '(p.featured * 100000 + p.sales * 4 + p.rating * 100 + CASE WHEN p.price_cents = 0 THEN 180 ELSE 0 END) DESC';
  const prompts = db.prepare(`
    SELECT p.id, p.title, c.name AS creator, cat.name AS category, p.model, p.price_cents AS priceCents,
      p.rating, p.sales, p.image, p.ratio, p.featured, p.created_at AS createdAt,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS favorite,
      CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END AS carted,
      p.description
    FROM prompts p
    JOIN creators c ON c.id = p.creator_id
    JOIN categories cat ON cat.id = p.category_id
    LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = @userId
    LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = @userId
    WHERE (@model IS NULL OR p.model = @model)
      AND (@category IS NULL OR p.category_id = @category)
      AND (@q IS NULL OR lower(p.title || ' ' || p.description || ' ' || cat.name || ' ' || p.model) LIKE @q)
      AND (@favorites = 0 OR f.prompt_id IS NOT NULL)
    ORDER BY ${order}
  `).all({ userId: demoUserId, model, category, q, favorites: input.favorites ? 1 : 0 }).map((row) => mapPrompt(row as PromptRow));
  const categories = db.prepare(`
    SELECT cat.id AS slug, cat.name, COUNT(p.id) AS count,
      SUM(CASE WHEN p.price_cents = 0 THEN 1 ELSE 0 END) AS freeCount,
      SUM(CASE WHEN p.price_cents > 0 THEN 1 ELSE 0 END) AS paidCount
    FROM categories cat LEFT JOIN prompts p ON p.category_id = cat.id
    GROUP BY cat.id ORDER BY cat.name
  `).all() as CatalogResponse['categories'];
  const counts = db.prepare(`
    SELECT COUNT(*) AS "all",
      SUM(CASE WHEN price_cents = 0 THEN 1 ELSE 0 END) AS free,
      SUM(CASE WHEN price_cents > 0 THEN 1 ELSE 0 END) AS paid,
      SUM(featured) AS featured,
      (SELECT COUNT(*) FROM favorites WHERE user_id = @userId) AS favorites,
      (SELECT COUNT(*) FROM cart_items WHERE user_id = @userId) AS cart
    FROM prompts
  `).get({ userId: demoUserId }) as CatalogResponse['counts'];
  return { prompts, categories, models: ['GPT-4o', 'Claude', 'Midjourney', 'Flux'], counts };
}

export function getPrompt(id: string): PromptCard | null {
  const row = db.prepare(`
    SELECT p.id, p.title, c.name AS creator, cat.name AS category, p.model, p.price_cents AS priceCents,
      p.rating, p.sales, p.image, p.ratio, p.featured, p.created_at AS createdAt,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS favorite,
      CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END AS carted,
      p.description
    FROM prompts p
    JOIN creators c ON c.id = p.creator_id
    JOIN categories cat ON cat.id = p.category_id
    LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = @userId
    LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = @userId
    WHERE p.id = @id
  `).get({ userId: demoUserId, id }) as PromptRow | undefined;
  return row ? mapPrompt(row) : null;
}

export function toggleFavorite(promptId: string) {
  const existing = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND prompt_id = ?').get(demoUserId, promptId);
  if (existing) db.prepare('DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?').run(demoUserId, promptId);
  else db.prepare('INSERT INTO favorites VALUES (?, ?, date())').run(demoUserId, promptId);
  return getPrompt(promptId);
}

export function addToCart(promptId: string) {
  db.prepare('INSERT OR IGNORE INTO cart_items VALUES (?, ?, date())').run(demoUserId, promptId);
  return getCart();
}

export function removeFromCart(promptId: string) {
  db.prepare('DELETE FROM cart_items WHERE user_id = ? AND prompt_id = ?').run(demoUserId, promptId);
  return getCart();
}

export function getCart(): CartSummary {
  const items = db.prepare(`
    SELECT p.id, p.title, c.name AS creator, cat.name AS category, p.model, p.price_cents AS priceCents,
      p.rating, p.sales, p.image, p.ratio, p.featured, p.created_at AS createdAt,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS favorite,
      1 AS carted, p.description
    FROM cart_items ci
    JOIN prompts p ON p.id = ci.prompt_id
    JOIN creators c ON c.id = p.creator_id
    JOIN categories cat ON cat.id = p.category_id
    LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ci.user_id
    WHERE ci.user_id = ? ORDER BY ci.created_at DESC
  `).all(demoUserId).map((row) => mapPrompt(row as PromptRow));
  const totals = db.prepare(`
    SELECT COALESCE(SUM(p.price_cents),0) AS subtotalCents,
      CAST(ROUND(COALESCE(SUM(p.price_cents),0) * 0.05) AS INTEGER) AS feeCents,
      COALESCE(SUM(p.price_cents),0) + CAST(ROUND(COALESCE(SUM(p.price_cents),0) * 0.05) AS INTEGER) AS totalCents
    FROM cart_items ci JOIN prompts p ON p.id = ci.prompt_id WHERE ci.user_id = ?
  `).get(demoUserId) as Omit<CartSummary, 'items'>;
  return { items, ...totals };
}

export function checkout() {
  const cart = getCart();
  if (cart.items.length === 0) return { orderId: null, cart };
  const orderId = `ord-${Date.now()}`;
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, datetime())').run(orderId, demoUserId, cart.subtotalCents, cart.feeCents, cart.totalCents);
    const insertItem = db.prepare('INSERT INTO order_items VALUES (?, ?, ?)');
    const bumpSales = db.prepare('UPDATE prompts SET sales = sales + 1 WHERE id = ?');
    cart.items.forEach((item) => { insertItem.run(orderId, item.id, item.priceCents); bumpSales.run(item.id); });
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(demoUserId);
  });
  tx();
  return { orderId, cart: getCart(), paid: cart };
}

export function getAnalytics(): AnalyticsSummary {
  const creatorRevenue = db.prepare(`
    SELECT c.name AS creator, COALESCE(SUM(oi.price_cents),0) AS revenueCents, COUNT(oi.prompt_id) AS sales,
      ROUND(CAST(COUNT(oi.prompt_id) AS REAL) / NULLIF(SUM(p.views),0), 4) AS conversionRate,
      CAST(ROUND(COALESCE(SUM(o.total_cents),0) / NULLIF(COUNT(DISTINCT o.id),0)) AS INTEGER) AS averageOrderValueCents
    FROM creators c
    JOIN prompts p ON p.creator_id = c.id
    LEFT JOIN order_items oi ON oi.prompt_id = p.id
    LEFT JOIN orders o ON o.id = oi.order_id
    GROUP BY c.id ORDER BY revenueCents DESC
  `).all() as AnalyticsSummary['creatorRevenue'];
  const categoryRevenue = db.prepare(`
    SELECT cat.name AS category, COALESCE(SUM(oi.price_cents),0) AS revenueCents, COUNT(oi.prompt_id) AS units
    FROM categories cat
    JOIN prompts p ON p.category_id = cat.id
    LEFT JOIN order_items oi ON oi.prompt_id = p.id
    GROUP BY cat.id ORDER BY revenueCents DESC
  `).all() as AnalyticsSummary['categoryRevenue'];
  const dailySales = db.prepare(`
    SELECT substr(created_at,1,10) AS day, SUM(total_cents) AS revenueCents, COUNT(*) AS orders
    FROM orders GROUP BY substr(created_at,1,10) ORDER BY day
  `).all() as AnalyticsSummary['dailySales'];
  const averagePrice = db.prepare('SELECT CAST(ROUND(AVG(price_cents)) AS INTEGER) AS averagePriceCents FROM prompts').get() as { averagePriceCents: number };
  return { creatorRevenue, categoryRevenue, dailySales, averagePriceCents: averagePrice.averagePriceCents };
}
