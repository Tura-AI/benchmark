import { n as TSS_SERVER_FUNCTION, t as createServerFn } from "../server.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
//#region node_modules/@tanstack/start-server-core/dist/esm/createServerRpc.js
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
//#endregion
//#region src/server/db.ts
var dbPath = process.env.POWERPROMPT_DB ?? join(process.cwd(), "data", "powerprompt.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
var db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
function migrate() {
	db.exec(`
    CREATE TABLE IF NOT EXISTS creators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL UNIQUE,
      bio TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      category_id TEXT NOT NULL REFERENCES categories(id),
      title TEXT NOT NULL,
      model TEXT NOT NULL CHECK(model IN ('GPT-4o','Claude','Midjourney','Flux')),
      price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      rating REAL NOT NULL,
      sales INTEGER NOT NULL,
      views INTEGER NOT NULL,
      image TEXT NOT NULL,
      ratio TEXT NOT NULL,
      featured INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt_id TEXT NOT NULL REFERENCES prompts(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt_id TEXT NOT NULL REFERENCES prompts(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      subtotal_cents INTEGER NOT NULL,
      fee_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      order_id TEXT NOT NULL REFERENCES orders(id),
      prompt_id TEXT NOT NULL REFERENCES prompts(id),
      price_cents INTEGER NOT NULL,
      PRIMARY KEY (order_id, prompt_id)
    );
  `);
}
var creators = [
	[
		"cr-1",
		"Mara Voss",
		"@mara",
		"Fashion retail prompt systems and editorial commerce."
	],
	[
		"cr-2",
		"Jun Park",
		"@jun",
		"Cinematic image workflows for launch teams."
	],
	[
		"cr-3",
		"Nadia Vale",
		"@nadia",
		"Conversion copy and agentic storefront prompts."
	],
	[
		"cr-4",
		"Iris Kato",
		"@iris",
		"Beauty, makeup, product and creator prompt packs."
	]
];
var categories = [
	[
		"beauty",
		"Beauty",
		"#c9fa46"
	],
	[
		"commerce",
		"Commerce",
		"#f7d774"
	],
	[
		"cinema",
		"Cinema",
		"#d7c5ff"
	],
	[
		"social",
		"Social",
		"#ffb6a5"
	],
	[
		"systems",
		"Systems",
		"#a8d8ff"
	]
];
var prompts = [
	[
		"gloss-editorial",
		"cr-4",
		"beauty",
		"Gloss Editorial Makeup Sheet",
		"GPT-4o",
		1900,
		4.9,
		842,
		6800,
		"/media/prompts/generate-media-replicate_z_image_turbo-1.png",
		"4 / 5",
		1,
		"Generate precise beauty campaign prompts with product, finish, shade and lighting controls.",
		"2026-06-28"
	],
	[
		"skin-tone-matrix",
		"cr-4",
		"beauty",
		"Inclusive Skin Tone Matrix",
		"Claude",
		2400,
		4.8,
		613,
		5100,
		"/media/prompts/generate-media-replicate_z_image_turbo-1.png",
		"1 / 1",
		1,
		"Audit and rewrite makeup prompts across undertone, age, texture and lighting conditions.",
		"2026-06-24"
	],
	[
		"launch-hero-kit",
		"cr-2",
		"cinema",
		"Launch Hero Film Kit",
		"Midjourney",
		3200,
		4.9,
		721,
		9300,
		"/media/prompts/generate-media-replicate_z_image_turbo-1-1.png",
		"3 / 4",
		1,
		"Cinematic visual prompt kit for product launch hero imagery and motion boards.",
		"2026-06-20"
	],
	[
		"flux-beauty-stills",
		"cr-2",
		"beauty",
		"Flux Beauty Still Builder",
		"Flux",
		2800,
		4.7,
		488,
		4400,
		"/media/prompts/generate-media-replicate_z_image_turbo-1-3.png",
		"5 / 7",
		0,
		"Flux-ready still life prompts for compact cosmetics, glass, powder and skin texture.",
		"2026-06-18"
	],
	[
		"cart-abandonment-agent",
		"cr-3",
		"commerce",
		"Cart Abandonment Agent",
		"GPT-4o",
		3900,
		4.8,
		534,
		7800,
		"/media/prompts/generate-media-replicate_z_image_turbo-1-2.png",
		"4 / 3",
		1,
		"Recover cart sessions with brand-safe reminders, offers and checkout context.",
		"2026-06-15"
	],
	[
		"ugc-shot-list",
		"cr-1",
		"social",
		"Creator UGC Shot List",
		"Claude",
		1700,
		4.6,
		304,
		2600,
		"/media/prompts/generate-media-replicate_z_image_turbo-1-2.png",
		"9 / 12",
		0,
		"Prompt a week of creator briefs with hooks, angles, claims and compliance notes.",
		"2026-06-11"
	],
	[
		"ad-variant-lab",
		"cr-3",
		"commerce",
		"Ad Variant Lab",
		"GPT-4o",
		2600,
		4.7,
		642,
		6100,
		"/media/prompts/generate-media-replicate_z_image_turbo-1-2.png",
		"1 / 1",
		1,
		"Generate and rank ad concepts by persona, objection, promise and proof.",
		"2026-06-08"
	],
	[
		"portrait-lighting-map",
		"cr-2",
		"cinema",
		"Portrait Lighting Map",
		"Midjourney",
		0,
		4.5,
		1090,
		12500,
		"/media/prompts/generate-media-replicate_z_image_turbo-1-1.png",
		"2 / 3",
		0,
		"Free lighting recipes for clean portrait and campaign image generation.",
		"2026-06-05"
	],
	[
		"shade-name-system",
		"cr-4",
		"beauty",
		"Shade Name System",
		"Claude",
		900,
		4.4,
		259,
		1900,
		"/media/prompts/generate-media-replicate_z_image_turbo-1.png",
		"4 / 5",
		0,
		"Create naming territories for color cosmetics without repeated generic language.",
		"2026-06-01"
	],
	[
		"prompt-api-spec",
		"cr-1",
		"systems",
		"Prompt API Spec Writer",
		"GPT-4o",
		2200,
		4.6,
		331,
		4100,
		"/media/prompts/generate-media-replicate_z_image_turbo-1-2.png",
		"5 / 4",
		0,
		"Turn marketplace prompt packs into structured JSON contracts and test fixtures.",
		"2026-05-29"
	],
	[
		"seasonal-drop-board",
		"cr-1",
		"commerce",
		"Seasonal Drop Board",
		"Flux",
		2100,
		4.5,
		288,
		3e3,
		"/media/prompts/generate-media-replicate_z_image_turbo-1-2.png",
		"3 / 4",
		0,
		"Plan a product drop with images, titles, bundles and channel-specific variants.",
		"2026-05-25"
	],
	[
		"makeup-macro-free",
		"cr-4",
		"beauty",
		"Makeup Macro Free Pack",
		"Midjourney",
		0,
		4.3,
		1180,
		13800,
		"/media/prompts/generate-media-replicate_z_image_turbo-1-3.png",
		"16 / 11",
		1,
		"Starter macro prompts for lipstick, powder, skin, gloss and glass highlights.",
		"2026-05-21"
	]
];
function seed() {
	migrate();
	if (db.prepare("SELECT COUNT(*) AS n FROM prompts").get().n > 0) return;
	const insertCreator = db.prepare("INSERT INTO creators VALUES (?, ?, ?, ?)");
	const insertCategory = db.prepare("INSERT INTO categories VALUES (?, ?, ?)");
	const insertPrompt = db.prepare(`INSERT INTO prompts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
	const insertUser = db.prepare("INSERT INTO users VALUES (?, ?)");
	const insertFavorite = db.prepare("INSERT INTO favorites VALUES (?, ?, ?)");
	const insertCart = db.prepare("INSERT INTO cart_items VALUES (?, ?, ?)");
	const insertOrder = db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)");
	const insertOrderItem = db.prepare("INSERT INTO order_items VALUES (?, ?, ?)");
	db.transaction(() => {
		creators.forEach((row) => insertCreator.run(...row));
		categories.forEach((row) => insertCategory.run(...row));
		prompts.forEach((row) => insertPrompt.run(...row));
		insertUser.run("user-demo", "Demo Buyer");
		insertFavorite.run("user-demo", "gloss-editorial", "2026-07-01");
		insertFavorite.run("user-demo", "portrait-lighting-map", "2026-07-02");
		insertCart.run("user-demo", "cart-abandonment-agent", "2026-07-03");
		insertCart.run("user-demo", "makeup-macro-free", "2026-07-03");
		[
			[
				"ord-1",
				"user-demo",
				5100,
				255,
				5355,
				"2026-06-28"
			],
			[
				"ord-2",
				"user-demo",
				4500,
				225,
				4725,
				"2026-06-29"
			],
			[
				"ord-3",
				"user-demo",
				3900,
				195,
				4095,
				"2026-07-01"
			]
		].forEach((row) => insertOrder.run(...row));
		[
			[
				"ord-1",
				"gloss-editorial",
				1900
			],
			[
				"ord-1",
				"launch-hero-kit",
				3200
			],
			[
				"ord-2",
				"skin-tone-matrix",
				2400
			],
			[
				"ord-2",
				"seasonal-drop-board",
				2100
			],
			[
				"ord-3",
				"cart-abandonment-agent",
				3900
			]
		].forEach((row) => insertOrderItem.run(...row));
	})();
}
seed();
var demoUserId = "user-demo";
//#endregion
//#region src/server/queries.ts
function mapPrompt(row) {
	return {
		...row,
		featured: row.featured === 1,
		isFavorite: row.favorite === 1,
		inCart: row.carted === 1
	};
}
function listCatalog(input = {}) {
	const model = input.model && input.model !== "all" ? input.model : null;
	const category = input.category && input.category !== "all" ? input.category : null;
	const q = input.q ? `%${input.q.toLowerCase()}%` : null;
	const sort = input.sort ?? "Featured";
	const order = sort === "Newest" ? "p.created_at DESC, p.sales DESC" : sort === "Popular" ? "p.sales DESC, p.rating DESC" : "(p.featured * 100000 + p.sales * 4 + p.rating * 100 + CASE WHEN p.price_cents = 0 THEN 180 ELSE 0 END) DESC";
	return {
		prompts: db.prepare(`
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
  `).all({
			userId: demoUserId,
			model,
			category,
			q,
			favorites: input.favorites ? 1 : 0
		}).map((row) => mapPrompt(row)),
		categories: db.prepare(`
    SELECT cat.id AS slug, cat.name, COUNT(p.id) AS count,
      SUM(CASE WHEN p.price_cents = 0 THEN 1 ELSE 0 END) AS freeCount,
      SUM(CASE WHEN p.price_cents > 0 THEN 1 ELSE 0 END) AS paidCount
    FROM categories cat LEFT JOIN prompts p ON p.category_id = cat.id
    GROUP BY cat.id ORDER BY cat.name
  `).all(),
		models: [
			"GPT-4o",
			"Claude",
			"Midjourney",
			"Flux"
		],
		counts: db.prepare(`
    SELECT COUNT(*) AS "all",
      SUM(CASE WHEN price_cents = 0 THEN 1 ELSE 0 END) AS free,
      SUM(CASE WHEN price_cents > 0 THEN 1 ELSE 0 END) AS paid,
      SUM(featured) AS featured,
      (SELECT COUNT(*) FROM favorites WHERE user_id = @userId) AS favorites,
      (SELECT COUNT(*) FROM cart_items WHERE user_id = @userId) AS cart
    FROM prompts
  `).get({ userId: demoUserId })
	};
}
function getPrompt(id) {
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
  `).get({
		userId: demoUserId,
		id
	});
	return row ? mapPrompt(row) : null;
}
function toggleFavorite(promptId) {
	if (db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND prompt_id = ?").get("user-demo", promptId)) db.prepare("DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?").run(demoUserId, promptId);
	else db.prepare("INSERT INTO favorites VALUES (?, ?, date())").run(demoUserId, promptId);
	return getPrompt(promptId);
}
function addToCart(promptId) {
	db.prepare("INSERT OR IGNORE INTO cart_items VALUES (?, ?, date())").run(demoUserId, promptId);
	return getCart();
}
function removeFromCart(promptId) {
	db.prepare("DELETE FROM cart_items WHERE user_id = ? AND prompt_id = ?").run(demoUserId, promptId);
	return getCart();
}
function getCart() {
	return {
		items: db.prepare(`
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
  `).all(demoUserId).map((row) => mapPrompt(row)),
		...db.prepare(`
    SELECT COALESCE(SUM(p.price_cents),0) AS subtotalCents,
      CAST(ROUND(COALESCE(SUM(p.price_cents),0) * 0.05) AS INTEGER) AS feeCents,
      COALESCE(SUM(p.price_cents),0) + CAST(ROUND(COALESCE(SUM(p.price_cents),0) * 0.05) AS INTEGER) AS totalCents
    FROM cart_items ci JOIN prompts p ON p.id = ci.prompt_id WHERE ci.user_id = ?
  `).get(demoUserId)
	};
}
function checkout() {
	const cart = getCart();
	if (cart.items.length === 0) return {
		orderId: null,
		cart
	};
	const orderId = `ord-${Date.now()}`;
	db.transaction(() => {
		db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?, datetime())").run(orderId, demoUserId, cart.subtotalCents, cart.feeCents, cart.totalCents);
		const insertItem = db.prepare("INSERT INTO order_items VALUES (?, ?, ?)");
		const bumpSales = db.prepare("UPDATE prompts SET sales = sales + 1 WHERE id = ?");
		cart.items.forEach((item) => {
			insertItem.run(orderId, item.id, item.priceCents);
			bumpSales.run(item.id);
		});
		db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(demoUserId);
	})();
	return {
		orderId,
		cart: getCart(),
		paid: cart
	};
}
function getAnalytics() {
	return {
		creatorRevenue: db.prepare(`
    SELECT c.name AS creator, COALESCE(SUM(oi.price_cents),0) AS revenueCents, COUNT(oi.prompt_id) AS sales,
      ROUND(CAST(COUNT(oi.prompt_id) AS REAL) / NULLIF(SUM(p.views),0), 4) AS conversionRate,
      CAST(ROUND(COALESCE(SUM(o.total_cents),0) / NULLIF(COUNT(DISTINCT o.id),0)) AS INTEGER) AS averageOrderValueCents
    FROM creators c
    JOIN prompts p ON p.creator_id = c.id
    LEFT JOIN order_items oi ON oi.prompt_id = p.id
    LEFT JOIN orders o ON o.id = oi.order_id
    GROUP BY c.id ORDER BY revenueCents DESC
  `).all(),
		categoryRevenue: db.prepare(`
    SELECT cat.name AS category, COALESCE(SUM(oi.price_cents),0) AS revenueCents, COUNT(oi.prompt_id) AS units
    FROM categories cat
    JOIN prompts p ON p.category_id = cat.id
    LEFT JOIN order_items oi ON oi.prompt_id = p.id
    GROUP BY cat.id ORDER BY revenueCents DESC
  `).all(),
		dailySales: db.prepare(`
    SELECT substr(created_at,1,10) AS day, SUM(total_cents) AS revenueCents, COUNT(*) AS orders
    FROM orders GROUP BY substr(created_at,1,10) ORDER BY day
  `).all(),
		averagePriceCents: db.prepare("SELECT CAST(ROUND(AVG(price_cents)) AS INTEGER) AS averagePriceCents FROM prompts").get().averagePriceCents
	};
}
//#endregion
//#region src/server/functions.ts?tss-serverfn-split
var catalogInput = z.object({
	model: z.string().optional(),
	category: z.string().optional(),
	sort: z.enum([
		"Featured",
		"Newest",
		"Popular"
	]).optional(),
	q: z.string().optional(),
	favorites: z.boolean().optional()
});
var promptInput = z.object({ promptId: z.string().min(1) });
var getCatalogFn_createServerFn_handler = createServerRpc({
	id: "22280aa419ab6fe111f40373b7a5bcd703591f084b854a2961084956e87eb10d",
	name: "getCatalogFn",
	filename: "src/server/functions.ts"
}, (opts) => getCatalogFn.__executeServer(opts));
var getCatalogFn = createServerFn({ method: "GET" }).validator((data) => catalogInput.parse(data ?? {})).handler(getCatalogFn_createServerFn_handler, ({ data }) => listCatalog(data));
var getPromptFn_createServerFn_handler = createServerRpc({
	id: "521f90fb1eb33240989f6de95c778a66a174f1297fbc3dc2abe27b749bdf966b",
	name: "getPromptFn",
	filename: "src/server/functions.ts"
}, (opts) => getPromptFn.__executeServer(opts));
var getPromptFn = createServerFn({ method: "GET" }).validator((data) => promptInput.parse(data)).handler(getPromptFn_createServerFn_handler, ({ data }) => getPrompt(data.promptId));
var toggleFavoriteFn_createServerFn_handler = createServerRpc({
	id: "469896283cff030cc9bc742d5b57d0523e86f532c737dc6c2de8e8212111ef87",
	name: "toggleFavoriteFn",
	filename: "src/server/functions.ts"
}, (opts) => toggleFavoriteFn.__executeServer(opts));
var toggleFavoriteFn = createServerFn({ method: "POST" }).validator((data) => promptInput.parse(data)).handler(toggleFavoriteFn_createServerFn_handler, ({ data }) => toggleFavorite(data.promptId));
var addToCartFn_createServerFn_handler = createServerRpc({
	id: "13799a03ae7e7b916d209dbe27de59c54730206602ac449aa88230f3f2f3850c",
	name: "addToCartFn",
	filename: "src/server/functions.ts"
}, (opts) => addToCartFn.__executeServer(opts));
var addToCartFn = createServerFn({ method: "POST" }).validator((data) => promptInput.parse(data)).handler(addToCartFn_createServerFn_handler, ({ data }) => addToCart(data.promptId));
var removeFromCartFn_createServerFn_handler = createServerRpc({
	id: "9cd9c31ab345fa0967ecdfc52dfda96db12aa517a28776ddd9c56ba22208f130",
	name: "removeFromCartFn",
	filename: "src/server/functions.ts"
}, (opts) => removeFromCartFn.__executeServer(opts));
var removeFromCartFn = createServerFn({ method: "POST" }).validator((data) => promptInput.parse(data)).handler(removeFromCartFn_createServerFn_handler, ({ data }) => removeFromCart(data.promptId));
var getCartFn_createServerFn_handler = createServerRpc({
	id: "13dd8f8d8da9e853736e64202f2ebfd2a0f118c2db4a90aed3bd3dfd037517b5",
	name: "getCartFn",
	filename: "src/server/functions.ts"
}, (opts) => getCartFn.__executeServer(opts));
var getCartFn = createServerFn({ method: "GET" }).handler(getCartFn_createServerFn_handler, () => getCart());
var checkoutFn_createServerFn_handler = createServerRpc({
	id: "d0e4d1410ee7278af658890a54f5561caddf0137bad34573e64966a4f328ca79",
	name: "checkoutFn",
	filename: "src/server/functions.ts"
}, (opts) => checkoutFn.__executeServer(opts));
var checkoutFn = createServerFn({ method: "POST" }).handler(checkoutFn_createServerFn_handler, () => checkout());
var getAnalyticsFn_createServerFn_handler = createServerRpc({
	id: "2aac43ce6a2882cb9124d98454a3954aba15ec4c6fa224b19fb952d642f612b7",
	name: "getAnalyticsFn",
	filename: "src/server/functions.ts"
}, (opts) => getAnalyticsFn.__executeServer(opts));
var getAnalyticsFn = createServerFn({ method: "GET" }).handler(getAnalyticsFn_createServerFn_handler, () => getAnalytics());
//#endregion
export { addToCartFn_createServerFn_handler, checkoutFn_createServerFn_handler, getAnalyticsFn_createServerFn_handler, getCartFn_createServerFn_handler, getCatalogFn_createServerFn_handler, getPromptFn_createServerFn_handler, removeFromCartFn_createServerFn_handler, toggleFavoriteFn_createServerFn_handler };
