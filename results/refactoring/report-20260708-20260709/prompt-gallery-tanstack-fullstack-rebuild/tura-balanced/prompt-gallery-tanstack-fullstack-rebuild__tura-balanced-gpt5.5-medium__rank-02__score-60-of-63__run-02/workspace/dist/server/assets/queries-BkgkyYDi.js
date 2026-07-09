import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
//#region src/db/seed.ts
var USER_ID = "user_demo";
var creators = [
	{
		id: "creator_atlas",
		name: "Atlas Studio",
		handle: "@atlas",
		tier: "studio"
	},
	{
		id: "creator_field",
		name: "Field & Co.",
		handle: "@field",
		tier: "agency"
	},
	{
		id: "creator_lumen",
		name: "Lumen",
		handle: "@lumen",
		tier: "pro"
	},
	{
		id: "creator_indie",
		name: "Independent Guild",
		handle: "@guild",
		tier: "collective"
	}
];
var categories = [
	"Image",
	"Photography",
	"Design",
	"Writing",
	"Code",
	"Marketing",
	"Productivity",
	"Research"
];
var prompts = [
	{
		id: 207,
		title: "Cinematic Still, 35mm",
		model: "Midjourney",
		category: "Image",
		price: 9,
		sold: 4700,
		rating: 5,
		creator: "creator_atlas",
		ar: "3/4",
		featured: 1,
		created: "2026-07-01",
		desc: "Film-grade stills with real lens language, focal length, grain, and lighting that reads as cinema."
	},
	{
		id: 233,
		title: "Ink Wash Warrior",
		model: "Midjourney",
		category: "Image",
		price: 12,
		sold: 2100,
		rating: 4.9,
		creator: "creator_indie",
		ar: "2/3",
		featured: 0,
		created: "2026-07-02",
		desc: "Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space."
	},
	{
		id: 174,
		title: "Editorial Photo Grade",
		model: "Flux",
		category: "Photography",
		price: 11,
		sold: 1300,
		rating: 4.9,
		creator: "creator_lumen",
		ar: "3/4",
		featured: 1,
		created: "2026-06-25",
		desc: "Magazine-style color grading with warm skin, deep shadow, and a quiet print look."
	},
	{
		id: 301,
		title: "Magazine Cover Maker",
		model: "GPT-4o",
		category: "Design",
		price: 14,
		sold: 3300,
		rating: 4.8,
		creator: "creator_field",
		ar: "4/5",
		featured: 1,
		created: "2026-07-07",
		desc: "Drop in a photo, get a full cover: masthead, cover lines, barcode, and layout direction."
	},
	{
		id: 118,
		title: "Studio Portrait, Soft Light",
		model: "Flux",
		category: "Photography",
		price: 10,
		sold: 1800,
		rating: 4.9,
		creator: "creator_lumen",
		ar: "4/5",
		featured: 0,
		created: "2026-06-20",
		desc: "Clean beauty light with believable falloff. Looks shot, not rendered."
	},
	{
		id: 198,
		title: "Logo Sketch, Mono-line",
		model: "Midjourney",
		category: "Design",
		price: 13,
		sold: 980,
		rating: 4.8,
		creator: "creator_field",
		ar: "1/1",
		featured: 0,
		created: "2026-06-28",
		desc: "Single-weight line marks with real negative-space thinking and vector-ready directions."
	},
	{
		id: 142,
		title: "The Cold-Email Closer",
		model: "GPT-4o",
		category: "Marketing",
		price: 12,
		sold: 2300,
		rating: 4.9,
		creator: "creator_indie",
		ar: "4/3",
		featured: 1,
		created: "2026-06-26",
		desc: "Cold emails that get replies. A tested four-line structure with subject variants baked in."
	},
	{
		id: 160,
		title: "Senior Code Reviewer",
		model: "Claude",
		category: "Code",
		price: 18,
		sold: 1100,
		rating: 4.8,
		creator: "creator_indie",
		ar: "1/1",
		featured: 0,
		created: "2026-06-24",
		desc: "Reviews your diff like a staff engineer: catches risk, suggests fixes, explains the why."
	},
	{
		id: 255,
		title: "Neon Street, Night",
		model: "Flux",
		category: "Photography",
		price: 8,
		sold: 2600,
		rating: 4.7,
		creator: "creator_atlas",
		ar: "3/4",
		featured: 0,
		created: "2026-07-04",
		desc: "Rain-slick neon with real reflections and grain. A cinematic night prompt with restraint."
	},
	{
		id: 189,
		title: "Brand Voice, Bottled",
		model: "Claude",
		category: "Marketing",
		price: 24,
		sold: 860,
		rating: 4.9,
		creator: "creator_field",
		ar: "4/3",
		featured: 1,
		created: "2026-06-22",
		desc: "Feed it three samples; get a reusable voice guide that writes in your exact tone."
	},
	{
		id: 211,
		title: "Anime Key Visual",
		model: "Midjourney",
		category: "Image",
		price: 15,
		sold: 3900,
		rating: 5,
		creator: "creator_atlas",
		ar: "2/3",
		featured: 1,
		created: "2026-07-03",
		desc: "Poster-grade key art with depth, rim light, and a clear focal subject."
	},
	{
		id: 31,
		title: "The Socratic Tutor",
		model: "GPT-4o",
		category: "Research",
		price: 0,
		sold: 9200,
		rating: 4.7,
		creator: "creator_indie",
		ar: "5/4",
		featured: 1,
		created: "2026-05-18",
		desc: "Never hands you the answer; leads you there with questions at the right difficulty."
	},
	{
		id: 276,
		title: "Product Shot, White BG",
		model: "Flux",
		category: "Photography",
		price: 9,
		sold: 1500,
		rating: 4.8,
		creator: "creator_lumen",
		ar: "1/1",
		featured: 0,
		created: "2026-07-05",
		desc: "Clean e-commerce hero shots with soft contact shadow, ready for storefront work."
	},
	{
		id: 212,
		title: "The Worldbuilder's Bible",
		model: "GPT-4o",
		category: "Writing",
		price: 29,
		sold: 720,
		rating: 5,
		creator: "creator_indie",
		ar: "4/5",
		featured: 0,
		created: "2026-07-03",
		desc: "Builds a consistent fictional world: geography, factions, history, and continuity."
	},
	{
		id: 248,
		title: "Vintage Film Poster",
		model: "Midjourney",
		category: "Design",
		price: 13,
		sold: 2200,
		rating: 4.9,
		creator: "creator_atlas",
		ar: "3/4",
		featured: 0,
		created: "2026-07-03",
		desc: "70s grain, bold type, halftone, and one-sheet framing pulled from archive language."
	},
	{
		id: 156,
		title: "Bug-to-Test Generator",
		model: "GPT-4o",
		category: "Code",
		price: 15,
		sold: 1900,
		rating: 4.8,
		creator: "creator_indie",
		ar: "4/3",
		featured: 0,
		created: "2026-06-27",
		desc: "Paste a bug report, get a failing test that reproduces it plus the fix and edge cases."
	},
	{
		id: 267,
		title: "Dreamy Bokeh Portrait",
		model: "Flux",
		category: "Photography",
		price: 10,
		sold: 1700,
		rating: 4.8,
		creator: "creator_lumen",
		ar: "4/5",
		featured: 0,
		created: "2026-07-04",
		desc: "Creamy backgrounds, golden-hour warmth, and eyes in razor focus."
	},
	{
		id: 101,
		title: "Meeting to Memo",
		model: "Claude",
		category: "Productivity",
		price: 6,
		sold: 5100,
		rating: 4.7,
		creator: "creator_indie",
		ar: "4/3",
		featured: 1,
		created: "2026-05-22",
		desc: "Turns a messy transcript into a crisp decision memo with owners, dates, and decisions."
	},
	{
		id: 290,
		title: "Concept Car, Studio",
		model: "Midjourney",
		category: "Image",
		price: 12,
		sold: 1400,
		rating: 4.8,
		creator: "creator_atlas",
		ar: "3/2",
		featured: 0,
		created: "2026-07-06",
		desc: "Automotive design renders with believable studio reflections and a real sense of scale."
	},
	{
		id: 77,
		title: "The Plot Doctor",
		model: "Claude",
		category: "Writing",
		price: 16,
		sold: 1400,
		rating: 4.9,
		creator: "creator_indie",
		ar: "1/1",
		featured: 0,
		created: "2026-05-20",
		desc: "Diagnoses why your story stalls and prescribes the fix: stakes, pacing, and scene work."
	},
	{
		id: 221,
		title: "Watercolor Cityscape",
		model: "Flux",
		category: "Image",
		price: 9,
		sold: 2e3,
		rating: 4.9,
		creator: "creator_lumen",
		ar: "3/4",
		featured: 0,
		created: "2026-07-01",
		desc: "Loose, luminous washes with confident linework, soft skies, and busy streets."
	},
	{
		id: 63,
		title: "Inbox Zero Strategist",
		model: "Claude",
		category: "Productivity",
		price: 8,
		sold: 3400,
		rating: 4.6,
		creator: "creator_indie",
		ar: "4/3",
		featured: 0,
		created: "2026-05-19",
		desc: "Triage, draft, and schedule a full inbox in one pass, sorted by what moves your week."
	}
];
var orders = [
	{
		id: 1,
		user: USER_ID,
		promptId: 301,
		qty: 1,
		total: 14,
		day: "2026-07-01"
	},
	{
		id: 2,
		user: USER_ID,
		promptId: 207,
		qty: 2,
		total: 18,
		day: "2026-07-02"
	},
	{
		id: 3,
		user: "user_creator",
		promptId: 31,
		qty: 1,
		total: 0,
		day: "2026-07-03"
	},
	{
		id: 4,
		user: "user_creator",
		promptId: 211,
		qty: 1,
		total: 15,
		day: "2026-07-04"
	},
	{
		id: 5,
		user: USER_ID,
		promptId: 189,
		qty: 1,
		total: 24,
		day: "2026-07-05"
	},
	{
		id: 6,
		user: "user_research",
		promptId: 101,
		qty: 3,
		total: 18,
		day: "2026-07-06"
	}
];
var initialFavorites = [
	31,
	207,
	301
];
var initialCart = [142, 276];
//#endregion
//#region src/db/schema.ts
function migrate(db) {
	db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      tier TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id),
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      sold INTEGER NOT NULL,
      rating REAL NOT NULL,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      aspect_ratio TEXT NOT NULL,
      description TEXT NOT NULL,
      featured INTEGER NOT NULL CHECK (featured IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
function seed(db) {
	if (db.prepare("SELECT COUNT(*) AS count FROM users").get().count > 0) return;
	db.transaction(() => {
		db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(USER_ID, "Demo Buyer");
		db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run("user_creator", "Creator Buyer");
		db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run("user_research", "Research Buyer");
		const insertCreator = db.prepare("INSERT INTO creators (id, name, handle, tier) VALUES (?, ?, ?, ?)");
		creators.forEach((creator) => insertCreator.run(creator.id, creator.name, creator.handle, creator.tier));
		const insertCategory = db.prepare("INSERT INTO categories (id, label) VALUES (?, ?)");
		categories.forEach((label) => insertCategory.run(label.toLowerCase(), label));
		const insertPrompt = db.prepare(`
      INSERT INTO prompts (id, title, model, category_id, price_cents, sold, rating, creator_id, aspect_ratio, description, featured, created_at)
      VALUES (@id, @title, @model, @categoryId, @priceCents, @sold, @rating, @creator, @ar, @desc, @featured, @created)
    `);
		prompts.forEach((prompt) => insertPrompt.run({
			...prompt,
			categoryId: prompt.category.toLowerCase(),
			priceCents: prompt.price * 100
		}));
		const insertFavorite = db.prepare("INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)");
		initialFavorites.forEach((id) => insertFavorite.run(USER_ID, id));
		const insertCart = db.prepare("INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (?, ?, 1)");
		initialCart.forEach((id) => insertCart.run(USER_ID, id));
		const insertOrder = db.prepare("INSERT INTO orders (id, user_id, prompt_id, quantity, total_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)");
		orders.forEach((order) => insertOrder.run(order.id, order.user, order.promptId, order.qty, order.total * 100, order.day));
	})();
}
//#endregion
//#region src/db/client.ts
var root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
var dbPath = process.env.POWERPROMPT_DB ?? join(root, "data", "powerprompt.sqlite3");
var instance;
function getDb() {
	if (!instance) {
		mkdirSync(dirname(dbPath), { recursive: true });
		instance = new Database(dbPath);
		migrate(instance);
		seed(instance);
	}
	return instance;
}
//#endregion
//#region src/db/queries.ts
function imageUrl(id, aspectRatio) {
	const [w, h] = aspectRatio.split("/").map(Number);
	const width = 640;
	return `https://picsum.photos/seed/pp${id}/${width}/${Math.round(width * h / w)}`;
}
function baseParams(filters) {
	return {
		userId: filters.userId ?? "user_demo",
		model: filters.model && filters.model !== "all" ? filters.model : null,
		category: filters.category && filters.category !== "all" ? filters.category.toLowerCase() : null,
		q: filters.q ? `%${filters.q.toLowerCase()}%` : null,
		favoritesOnly: filters.favoritesOnly ? 1 : 0,
		freeOnly: filters.freeOnly ? 1 : 0
	};
}
function orderSql(sort = "featured") {
	if (sort === "newest") return "p.created_at DESC, p.id DESC";
	if (sort === "popular") return "p.rating DESC, p.sold DESC, p.id DESC";
	return "p.featured DESC, ((p.rating * 120) + (p.sold / 20.0) + (p.featured * 250) - (p.price_cents / 100.0)) DESC, p.sold DESC, p.id DESC";
}
function listPrompts(filters = {}, db = getDb()) {
	return db.prepare(`
      SELECT
        p.id, p.title, p.model, c.label AS category, p.price_cents AS priceCents,
        p.sold, p.rating, cr.name AS creator, cr.id AS creatorId,
        p.aspect_ratio AS aspectRatio, p.description, p.featured, p.created_at AS createdAt,
        CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS isFavorite,
        ROUND((p.rating * 120) + (p.sold / 20.0) + (p.featured * 250) - (p.price_cents / 100.0), 2) AS rankScore
      FROM prompts p
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = @userId
      WHERE (@model IS NULL OR p.model = @model)
        AND (@category IS NULL OR p.category_id = @category)
        AND (@q IS NULL OR lower(p.title || ' ' || p.model || ' ' || c.label || ' ' || p.description) LIKE @q)
        AND (@favoritesOnly = 0 OR f.prompt_id IS NOT NULL)
        AND (@freeOnly = 0 OR p.price_cents = 0)
      ORDER BY ${orderSql(filters.sort)}
      `).all(baseParams(filters)).map((row) => ({
		...row,
		imageUrl: imageUrl(row.id, row.aspectRatio)
	}));
}
function getPrompt(id, userId = USER_ID, db = getDb()) {
	return db.prepare(`
      SELECT p.id, p.title, p.model, c.label AS category, p.price_cents AS priceCents,
        p.sold, p.rating, cr.name AS creator, cr.id AS creatorId, p.aspect_ratio AS aspectRatio,
        p.description, p.featured, p.created_at AS createdAt,
        CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS isFavorite,
        ROUND((p.rating * 120) + (p.sold / 20.0) + (p.featured * 250) - (p.price_cents / 100.0), 2) AS rankScore
      FROM prompts p
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
      WHERE p.id = ?
      `).get(userId, id);
}
function getCategories(db = getDb()) {
	return db.prepare("SELECT label, id FROM categories ORDER BY rowid").all();
}
function getFilterCounts(userId = USER_ID, db = getDb()) {
	const counts = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN featured = 1 THEN 1 ELSE 0 END) AS featured,
        SUM(CASE WHEN price_cents = 0 THEN 1 ELSE 0 END) AS free,
        (SELECT COUNT(*) FROM favorites WHERE user_id = ?) AS favorites,
        (SELECT COUNT(*) FROM cart_items WHERE user_id = ?) AS cart
      FROM prompts
      `).get(userId, userId);
	const models = db.prepare("SELECT model, COUNT(*) AS count FROM prompts GROUP BY model ORDER BY model").all();
	return {
		...counts,
		models
	};
}
function toggleFavorite(promptId, userId = USER_ID, db = getDb()) {
	if (db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND prompt_id = ?").get(userId, promptId)) {
		db.prepare("DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?").run(userId, promptId);
		return { isFavorite: false };
	}
	db.prepare("INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)").run(userId, promptId);
	return { isFavorite: true };
}
function addToCart(promptId, userId = USER_ID, db = getDb()) {
	db.prepare(`
    INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (?, ?, 1)
    ON CONFLICT(user_id, prompt_id) DO UPDATE SET quantity = quantity + 1
    `).run(userId, promptId);
	return getCart(userId, db);
}
function removeFromCart(promptId, userId = USER_ID, db = getDb()) {
	db.prepare("DELETE FROM cart_items WHERE user_id = ? AND prompt_id = ?").run(userId, promptId);
	return getCart(userId, db);
}
function getCart(userId = USER_ID, db = getDb()) {
	const items = db.prepare(`
      SELECT p.id, p.title, p.model, c.label AS category, p.price_cents AS priceCents,
        p.aspect_ratio AS aspectRatio, ci.quantity, cr.name AS creator,
        p.price_cents * ci.quantity AS lineTotalCents
      FROM cart_items ci
      JOIN prompts p ON p.id = ci.prompt_id
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      WHERE ci.user_id = ?
      ORDER BY ci.rowid
      `).all(userId);
	const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
	const feeCents = subtotalCents > 0 ? Math.round(subtotalCents * .08) : 0;
	const totalCents = subtotalCents + feeCents;
	return {
		items: items.map((item) => ({
			...item,
			imageUrl: imageUrl(item.id, item.aspectRatio)
		})),
		subtotalCents,
		feeCents,
		totalCents,
		count: items.reduce((sum, item) => sum + item.quantity, 0)
	};
}
function checkout(userId = USER_ID, db = getDb()) {
	const cart = getCart(userId, db);
	if (cart.items.length === 0) return {
		ok: false,
		orderIds: [],
		cart
	};
	return {
		ok: true,
		orderIds: db.transaction(() => {
			const next = db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM orders").get();
			const insert = db.prepare("INSERT INTO orders (id, user_id, prompt_id, quantity, total_cents, created_at) VALUES (?, ?, ?, ?, ?, date())");
			const orderIds = [];
			cart.items.forEach((item, index) => {
				const id = next.id + index;
				orderIds.push(id);
				insert.run(id, userId, item.id, item.quantity, item.lineTotalCents);
			});
			db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(userId);
			return orderIds;
		})(),
		cart: getCart(userId, db)
	};
}
function getAnalytics(db = getDb()) {
	const summary = db.prepare(`
    SELECT
      COUNT(*) AS orders,
      COALESCE(SUM(total_cents), 0) AS revenueCents,
      ROUND(COALESCE(AVG(NULLIF(total_cents, 0)), 0), 2) AS averageOrderCents,
      ROUND((COUNT(*) * 100.0) / NULLIF((SELECT SUM(sold) FROM prompts), 0), 4) AS conversionRate
    FROM orders
    `).get();
	const creatorRevenue = db.prepare(`
    SELECT cr.name AS creator, COALESCE(SUM(o.total_cents), 0) AS revenueCents,
      ROUND(COALESCE(SUM(o.total_cents), 0) * 0.85, 0) AS creatorRevenueCents,
      COUNT(o.id) AS orders
    FROM creators cr
    LEFT JOIN prompts p ON p.creator_id = cr.id
    LEFT JOIN orders o ON o.prompt_id = p.id
    GROUP BY cr.id
    ORDER BY creatorRevenueCents DESC
    `).all();
	const categoryRevenue = db.prepare(`
    SELECT c.label AS category, COALESCE(SUM(o.total_cents), 0) AS revenueCents, COUNT(o.id) AS orders
    FROM categories c
    LEFT JOIN prompts p ON p.category_id = c.id
    LEFT JOIN orders o ON o.prompt_id = p.id
    GROUP BY c.id
    ORDER BY revenueCents DESC, c.label ASC
    `).all();
	const dailySales = db.prepare(`
    SELECT created_at AS day, COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS revenueCents
    FROM orders
    GROUP BY created_at
    ORDER BY created_at ASC
    `).all();
	const averagePrice = db.prepare("SELECT ROUND(AVG(price_cents), 2) AS averagePriceCents FROM prompts WHERE price_cents > 0").get();
	return {
		summary: {
			...summary,
			averagePriceCents: averagePrice.averagePriceCents
		},
		creatorRevenue,
		categoryRevenue,
		dailySales
	};
}
//#endregion
export { getCategories as a, imageUrl as c, toggleFavorite as d, USER_ID as f, getCart as i, listPrompts as l, checkout as n, getFilterCounts as o, getAnalytics as r, getPrompt as s, addToCart as t, removeFromCart as u };
