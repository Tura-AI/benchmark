import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const userId = 1;
const creators = [
  { id: 1, name: "Atlas Studio", handle: "@atlas", commissionRate: 0.82 },
  { id: 2, name: "Lumen", handle: "@lumen", commissionRate: 0.8 },
  { id: 3, name: "Field & Co.", handle: "@fieldco", commissionRate: 0.78 },
  { id: 4, name: "Ops Guild", handle: "@opsguild", commissionRate: 0.84 },
  { id: 5, name: "Sakuga", handle: "@sakuga", commissionRate: 0.81 },
  { id: 6, name: "Claude Lab", handle: "@claudelab", commissionRate: 0.79 }
];
const categories = ["Image", "Photography", "Design", "Writing", "Code", "Marketing", "Productivity", "Research"];
const prompts = [
  { id: 207, title: "Cinematic Still, 35mm", model: "Midjourney", category: "Image", price: 9, sold: 4700, rating: 5, creatorId: 1, aspectRatio: "3/4", description: "Film-grade stills with real lens language, focal length, grain, and lighting that reads as cinema." },
  { id: 233, title: "Ink Wash Warrior", model: "Midjourney", category: "Image", price: 12, sold: 2100, rating: 4.9, creatorId: 5, aspectRatio: "2/3", description: "Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space." },
  { id: 174, title: "Editorial Photo Grade", model: "Flux", category: "Photography", price: 11, sold: 1300, rating: 4.9, creatorId: 2, aspectRatio: "3/4", description: "Magazine-style color grading. Warm skin, deep shadow, that quiet print look without garish presets." },
  { id: 301, title: "Magazine Cover Maker", model: "GPT-4o", category: "Design", price: 14, sold: 3300, rating: 4.8, creatorId: 3, aspectRatio: "4/5", description: "Drop in a photo and get a full cover system with masthead, cover lines, barcode, and layout notes." },
  { id: 118, title: "Studio Portrait, Soft Light", model: "Flux", category: "Photography", price: 10, sold: 1800, rating: 4.9, creatorId: 2, aspectRatio: "4/5", description: "Clean beauty light with a believable falloff. Looks shot, not rendered." },
  { id: 198, title: "Logo Sketch, Mono-line", model: "Midjourney", category: "Design", price: 13, sold: 980, rating: 4.8, creatorId: 3, aspectRatio: "1/1", description: "Single-weight line marks with real negative-space thinking. Vector-ready directions, fast." },
  { id: 142, title: "The Cold-Email Closer", model: "GPT-4o", category: "Marketing", price: 12, sold: 2300, rating: 4.9, creatorId: 3, aspectRatio: "4/3", description: "Cold emails that get replies. A tested four-line structure with subject-line variants baked in." },
  { id: 160, title: "Senior Code Reviewer", model: "Claude", category: "Code", price: 18, sold: 1100, rating: 4.8, creatorId: 6, aspectRatio: "1/1", description: "Reviews your diff like a staff engineer, catches risk, suggests fixes, and explains the why." },
  { id: 255, title: "Neon Street, Night", model: "Flux", category: "Photography", price: 8, sold: 2600, rating: 4.7, creatorId: 2, aspectRatio: "3/4", description: "Rain-slick neon with real reflections and grain. That low-budget cyberpunk look, nailed." },
  { id: 189, title: "Brand Voice, Bottled", model: "Claude", category: "Marketing", price: 24, sold: 860, rating: 4.9, creatorId: 3, aspectRatio: "4/3", description: "Feed it three samples; get a reusable voice guide that writes anything in your exact tone." },
  { id: 211, title: "Anime Key Visual", model: "Midjourney", category: "Image", price: 15, sold: 3900, rating: 5, creatorId: 5, aspectRatio: "2/3", description: "Poster-grade key art with depth, light direction, and a real focal subject. Print at A2." },
  { id: 31, title: "The Socratic Tutor", model: "GPT-4o", category: "Research", price: 0, sold: 9200, rating: 4.7, creatorId: 4, aspectRatio: "5/4", description: "Never hands you the answer; leads you there with questions at exactly the right difficulty." },
  { id: 276, title: "Product Shot, White BG", model: "Flux", category: "Photography", price: 9, sold: 1500, rating: 4.8, creatorId: 2, aspectRatio: "1/1", description: "Clean e-commerce hero shots with soft contact shadow. Drop-in ready for any storefront." },
  { id: 212, title: "The Worldbuilder's Bible", model: "GPT-4o", category: "Writing", price: 29, sold: 720, rating: 5, creatorId: 6, aspectRatio: "4/5", description: "Builds a consistent fictional world: geography, factions, history, and continuity." },
  { id: 248, title: "Vintage Film Poster", model: "Midjourney", category: "Design", price: 13, sold: 2200, rating: 4.9, creatorId: 1, aspectRatio: "3/4", description: "70s grain, bold type, halftone, and one-sheets that look pulled from an archive." },
  { id: 156, title: "Bug-to-Test Generator", model: "GPT-4o", category: "Code", price: 15, sold: 1900, rating: 4.8, creatorId: 6, aspectRatio: "4/3", description: "Paste a bug report, get a failing test that reproduces it, plus the fix and edge cases." },
  { id: 267, title: "Dreamy Bokeh Portrait", model: "Flux", category: "Photography", price: 10, sold: 1700, rating: 4.8, creatorId: 2, aspectRatio: "4/5", description: "Creamy backgrounds, golden-hour warmth, eyes in razor focus. Pure mood." },
  { id: 101, title: "Meeting to Memo", model: "Claude", category: "Productivity", price: 6, sold: 5100, rating: 4.7, creatorId: 4, aspectRatio: "4/3", description: "Turns a messy transcript into a crisp decision memo: owners, dates, and the thing that matters." },
  { id: 290, title: "Concept Car, Studio", model: "Midjourney", category: "Image", price: 12, sold: 1400, rating: 4.8, creatorId: 1, aspectRatio: "3/2", description: "Automotive design renders with believable studio reflections and a real sense of scale." },
  { id: 77, title: "The Plot Doctor", model: "Claude", category: "Writing", price: 16, sold: 1400, rating: 4.9, creatorId: 6, aspectRatio: "1/1", description: "Diagnoses why your story stalls and prescribes the fix: stakes, pacing, and the scene you are dodging." },
  { id: 221, title: "Watercolor Cityscape", model: "Flux", category: "Image", price: 9, sold: 2e3, rating: 4.9, creatorId: 1, aspectRatio: "3/4", description: "Loose, luminous washes with confident linework. Soft skies, busy streets." },
  { id: 63, title: "Inbox Zero Strategist", model: "Claude", category: "Productivity", price: 8, sold: 3400, rating: 4.6, creatorId: 4, aspectRatio: "4/3", description: "Triage, draft, and schedule a full inbox in one pass, sorted by what moves your week." }
];
const defaultPath = resolve(process.cwd(), "data", "powerprompt.json");
function createConnection(path = process.env.POWERPROMPT_DB_PATH ?? defaultPath) {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(seedState(), null, 2));
  return new FileDb(path);
}
class FileDb {
  constructor(path) {
    this.path = path;
  }
  read() {
    return JSON.parse(readFileSync(this.path, "utf-8"));
  }
  write(state) {
    writeFileSync(this.path, JSON.stringify(state, null, 2));
  }
  transaction(fn) {
    const state = this.read();
    const result = fn(state);
    this.write(state);
    return result;
  }
}
let singleton;
function getDb() {
  singleton ??= createConnection();
  return singleton;
}
function seedState() {
  const categoryRows = categories.map((name, index) => ({ id: index + 1, name }));
  const dbPrompts = prompts.map((prompt, index) => {
    const [w, h] = prompt.aspectRatio.split("/").map(Number);
    const width = 720;
    const height = Math.round(width * h / w);
    return {
      ...prompt,
      slug: prompt.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      imageUrl: `https://picsum.photos/seed/pp${prompt.id}/${width}/${height}`,
      createdAt: new Date(Date.UTC(2026, 5, 1 + index)).toISOString()
    };
  });
  const orderDefs = [
    { id: 1, day: "2026-06-01", items: [207, 31, 101] },
    { id: 2, day: "2026-06-02", items: [301, 142] },
    { id: 3, day: "2026-06-03", items: [211, 255, 276] },
    { id: 4, day: "2026-06-04", items: [160, 156] },
    { id: 5, day: "2026-06-05", items: [189, 63, 77] },
    { id: 6, day: "2026-06-06", items: [248, 221, 118] }
  ];
  const orders = [];
  const orderItems = [];
  for (const order of orderDefs) {
    const items = order.items.map((id) => dbPrompts.find((prompt) => prompt.id === id)).filter(Boolean);
    const subtotal = items.reduce((sum, prompt) => sum + prompt.price, 0);
    const fees = Math.round(subtotal * 0.08 * 100) / 100;
    orders.push({ id: order.id, userId, createdAt: `${order.day}T12:00:00.000Z`, subtotal, fees, total: subtotal + fees });
    items.forEach((prompt) => orderItems.push({ orderId: order.id, promptId: prompt.id, price: prompt.price, creatorId: prompt.creatorId, categoryId: categoryRows.find((row) => row.name === prompt.category).id }));
  }
  return {
    users: [{ id: userId, email: "maker@powerprompt.local" }],
    creators,
    categories: categoryRows,
    prompts: dbPrompts,
    favorites: [207, 31, 101, 211].map((promptId) => ({ userId, promptId })),
    cartItems: [142, 276].map((promptId) => ({ userId, promptId, quantity: 1 })),
    orders,
    orderItems,
    sessions: Array.from({ length: 40 }, (_, index) => ({ userId, createdAt: `2026-06-${String(index % 8 + 1).padStart(2, "0")}T09:00:00.000Z`, converted: index < 14 ? 1 : 0 }))
  };
}
function dbOrDefault(db) {
  return db ?? getDb();
}
function listCategories(db) {
  return dbOrDefault(db).read().categories.map(({ name }) => ({ name }));
}
function listPrompts(filters = {}, db) {
  const state = dbOrDefault(db).read();
  return state.prompts.filter((prompt) => matchesFilters(prompt, state, filters)).map((prompt) => toPromptCard(prompt, state)).sort(sortPrompts(filters.sort ?? "featured"));
}
function getPrompt(slugOrId, db) {
  const state = dbOrDefault(db).read();
  const prompt = state.prompts.find((item) => item.slug === String(slugOrId) || item.id === Number(slugOrId));
  return prompt ? toPromptCard(prompt, state) : void 0;
}
function getFilterCounts(db) {
  const prompts2 = dbOrDefault(db).read().prompts;
  return {
    free: prompts2.filter((prompt) => prompt.price === 0).length,
    paid: prompts2.filter((prompt) => prompt.price > 0).length,
    featured: prompts2.filter((prompt) => prompt.sold >= 2e3).length
  };
}
function toggleFavorite(promptId, db) {
  return dbOrDefault(db).transaction((state) => {
    const index = state.favorites.findIndex((row) => row.userId === userId && row.promptId === promptId);
    if (index >= 0) {
      state.favorites.splice(index, 1);
      return false;
    }
    state.favorites.push({ userId, promptId });
    return true;
  });
}
function addToCart(promptId, db) {
  dbOrDefault(db).transaction((state) => {
    if (!state.cartItems.some((row) => row.userId === userId && row.promptId === promptId)) {
      state.cartItems.push({ userId, promptId, quantity: 1 });
    }
  });
  return getCart(db);
}
function removeFromCart(promptId, db) {
  dbOrDefault(db).transaction((state) => {
    state.cartItems = state.cartItems.filter((row) => !(row.userId === userId && row.promptId === promptId));
  });
  return getCart(db);
}
function getCart(db) {
  const state = dbOrDefault(db).read();
  const items = state.cartItems.filter((row) => row.userId === userId).map((row) => state.prompts.find((prompt) => prompt.id === row.promptId)).filter(Boolean).map((prompt) => toPromptCard(prompt, state)).sort((a, b) => a.title.localeCompare(b.title));
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  const fees = roundMoney(subtotal * 0.08);
  const totals = { subtotal, fees, total: roundMoney(subtotal + fees), itemCount: items.length };
  return { items, totals };
}
function checkout(db) {
  const conn = dbOrDefault(db);
  const cart = getCart(conn);
  if (!cart.items.length) return { ok: false, orderId: null, cart };
  const orderId = conn.transaction((state) => {
    const next = Math.max(0, ...state.orders.map((order) => order.id)) + 1;
    state.orders.push({ id: next, userId, createdAt: (/* @__PURE__ */ new Date()).toISOString(), subtotal: cart.totals.subtotal, fees: cart.totals.fees, total: cart.totals.total });
    cart.items.forEach((item) => {
      const prompt = state.prompts.find((row) => row.id === item.id);
      const category = state.categories.find((row) => row.name === prompt.category);
      state.orderItems.push({ orderId: next, promptId: prompt.id, price: prompt.price, creatorId: prompt.creatorId, categoryId: category.id });
    });
    state.cartItems = state.cartItems.filter((row) => row.userId !== userId);
    return next;
  });
  return { ok: true, orderId, cart: getCart(conn) };
}
function getAnalytics(db) {
  const state = dbOrDefault(db).read();
  const sessionCount = state.sessions.length || 1;
  const converted = state.sessions.filter((session) => session.converted).length;
  const creatorRevenue = state.creators.map((creator) => {
    const rows = state.orderItems.filter((item) => item.creatorId === creator.id);
    return {
      creator: creator.name,
      revenue: roundMoney(rows.reduce((sum, item) => sum + item.price * creator.commissionRate, 0)),
      sales: rows.length,
      conversionRate: roundRatio(rows.length / sessionCount),
      averageOrderValue: roundMoney(rows.reduce((sum, item) => sum + item.price, 0) / Math.max(1, new Set(rows.map((item) => item.orderId)).size))
    };
  }).filter((row) => row.sales > 0).sort((a, b) => b.revenue - a.revenue);
  const categoryRevenue = state.categories.map((category) => {
    const rows = state.orderItems.filter((item) => item.categoryId === category.id);
    return { category: category.name, revenue: roundMoney(rows.reduce((sum, item) => sum + item.price, 0)), sales: rows.length };
  }).filter((row) => row.sales > 0).sort((a, b) => b.revenue - a.revenue);
  const dailyMap = /* @__PURE__ */ new Map();
  state.orders.forEach((order) => {
    const day = order.createdAt.slice(0, 10);
    const row = dailyMap.get(day) ?? { revenue: 0, orders: 0 };
    row.revenue += order.total;
    row.orders += 1;
    dailyMap.set(day, row);
  });
  const dailySales = [...dailyMap.entries()].map(([day, row]) => ({ day, revenue: roundMoney(row.revenue), orders: row.orders })).sort((a, b) => a.day.localeCompare(b.day));
  const revenue = roundMoney(state.orders.reduce((sum, order) => sum + order.total, 0));
  return {
    creatorRevenue,
    categoryRevenue,
    dailySales,
    totals: { revenue, orders: state.orders.length, conversionRate: roundRatio(converted / sessionCount), averageOrderValue: roundMoney(revenue / Math.max(1, state.orders.length)) }
  };
}
function matchesFilters(prompt, state, filters) {
  if (filters.model && filters.model !== "all" && prompt.model !== filters.model) return false;
  if (filters.category && filters.category !== "all" && prompt.category !== filters.category) return false;
  if (filters.favoritesOnly && !state.favorites.some((row) => row.userId === userId && row.promptId === prompt.id)) return false;
  if (filters.priceMode === "free" && prompt.price !== 0) return false;
  if (filters.priceMode === "paid" && prompt.price <= 0) return false;
  if (filters.term) {
    const creator = state.creators.find((row) => row.id === prompt.creatorId)?.name ?? "";
    const haystack = `${prompt.title} ${prompt.model} ${prompt.category} ${prompt.description} ${creator}`.toLowerCase();
    if (!haystack.includes(filters.term.toLowerCase())) return false;
  }
  return true;
}
function sortPrompts(sort) {
  return (a, b) => {
    if (sort === "newest") return b.id - a.id;
    if (sort === "popular") return b.rating - a.rating || b.sold - a.sold;
    return b.rankScore - a.rankScore || b.sold - a.sold;
  };
}
function toPromptCard(prompt, state) {
  return {
    id: prompt.id,
    slug: prompt.slug,
    title: prompt.title,
    model: prompt.model,
    category: prompt.category,
    price: prompt.price,
    sold: prompt.sold,
    rating: prompt.rating,
    creator: state.creators.find((creator) => creator.id === prompt.creatorId)?.name ?? "POWERPROMPT",
    aspectRatio: prompt.aspectRatio,
    description: prompt.description,
    imageUrl: prompt.imageUrl,
    isFavorite: state.favorites.some((row) => row.userId === userId && row.promptId === prompt.id),
    inCart: state.cartItems.some((row) => row.userId === userId && row.promptId === prompt.id),
    rankScore: roundMoney(prompt.sold * 0.68 + prompt.rating * 280 + (prompt.price === 0 ? 320 : 0))
  };
}
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
function roundRatio(value) {
  return Math.round(value * 1e3) / 1e3;
}
export {
  getFilterCounts as a,
  listPrompts as b,
  getAnalytics as c,
  getPrompt as d,
  addToCart as e,
  checkout as f,
  getCart as g,
  listCategories as l,
  removeFromCart as r,
  toggleFavorite as t
};
