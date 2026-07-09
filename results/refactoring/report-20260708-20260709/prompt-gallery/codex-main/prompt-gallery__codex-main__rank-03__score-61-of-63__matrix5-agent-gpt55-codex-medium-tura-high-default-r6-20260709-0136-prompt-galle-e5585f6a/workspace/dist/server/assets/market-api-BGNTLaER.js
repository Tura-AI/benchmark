import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "../server.js";
import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
//#region node_modules/@tanstack/start-server-core/dist/esm/createSsrRpc.js
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
//#endregion
//#region src/data/seed.ts
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
var creators = [
	{
		name: "Atlas Studio",
		handle: "@atlas",
		avatar: "AS"
	},
	{
		name: "Lumen",
		handle: "@lumen",
		avatar: "LU"
	},
	{
		name: "Field & Co.",
		handle: "@field",
		avatar: "FC"
	},
	{
		name: "Marta Vey",
		handle: "@marta",
		avatar: "MV"
	},
	{
		name: "Sumi Lab",
		handle: "@sumi",
		avatar: "SL"
	},
	{
		name: "N. Sorensen",
		handle: "@nsorensen",
		avatar: "NS"
	},
	{
		name: "Studio Ko",
		handle: "@ko",
		avatar: "KO"
	},
	{
		name: "D. Okonkwo",
		handle: "@dokonkwo",
		avatar: "DO"
	},
	{
		name: "Kuro",
		handle: "@kuro",
		avatar: "KU"
	},
	{
		name: "Sakuga",
		handle: "@sakuga",
		avatar: "SA"
	},
	{
		name: "J. Halloran",
		handle: "@halloran",
		avatar: "JH"
	},
	{
		name: "E. Castellanos",
		handle: "@ecast",
		avatar: "EC"
	},
	{
		name: "Reel",
		handle: "@reel",
		avatar: "RE"
	},
	{
		name: "R. Mehta",
		handle: "@rmehta",
		avatar: "RM"
	},
	{
		name: "Ops Guild",
		handle: "@opsguild",
		avatar: "OG"
	},
	{
		name: "Forme",
		handle: "@forme",
		avatar: "FO"
	},
	{
		name: "H. Mbeki",
		handle: "@hmbeki",
		avatar: "HM"
	},
	{
		name: "Aquarelle",
		handle: "@aquarelle",
		avatar: "AQ"
	},
	{
		name: "Lina P.",
		handle: "@linap",
		avatar: "LP"
	}
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
		creator: "Atlas Studio",
		aspect: "3/4",
		featured: 1,
		date: "2026-06-21",
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
		creator: "Sumi Lab",
		aspect: "2/3",
		featured: 1,
		date: "2026-06-30",
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
		creator: "N. Sorensen",
		aspect: "3/4",
		featured: 0,
		date: "2026-06-13",
		desc: "Magazine-style color grading. Warm skin, deep shadow, that quiet print look without garish presets."
	},
	{
		id: 301,
		title: "Magazine Cover Maker",
		model: "GPT-4o",
		category: "Design",
		price: 14,
		sold: 3300,
		rating: 4.8,
		creator: "Field & Co.",
		aspect: "4/5",
		featured: 1,
		date: "2026-07-02",
		desc: "Drop in a photo, get a full cover with masthead, cover lines, barcode, and production notes."
	},
	{
		id: 118,
		title: "Studio Portrait, Soft Light",
		model: "Flux",
		category: "Photography",
		price: 10,
		sold: 1800,
		rating: 4.9,
		creator: "Lumen",
		aspect: "4/5",
		featured: 1,
		date: "2026-06-06",
		desc: "Clean beauty light with a believable falloff. Looks shot, not rendered."
	},
	{
		id: 198,
		title: "Logo Sketch, Mono-line",
		model: "Midjourney",
		category: "Design",
		price: 13,
		sold: 980,
		rating: 4.8,
		creator: "Studio Ko",
		aspect: "1/1",
		featured: 0,
		date: "2026-06-18",
		desc: "Single-weight line marks with real negative-space thinking. Vector-ready directions, fast."
	},
	{
		id: 142,
		title: "The Cold-Email Closer",
		model: "GPT-4o",
		category: "Marketing",
		price: 12,
		sold: 2300,
		rating: 4.9,
		creator: "Marta Vey",
		aspect: "4/3",
		featured: 1,
		date: "2026-06-10",
		desc: "Cold emails that actually get replies. A tested four-line structure with subject-line variants baked in."
	},
	{
		id: 160,
		title: "Senior Code Reviewer",
		model: "Claude",
		category: "Code",
		price: 18,
		sold: 1100,
		rating: 4.8,
		creator: "D. Okonkwo",
		aspect: "1/1",
		featured: 0,
		date: "2026-06-12",
		desc: "Reviews your diff like a staff engineer, catches risk, suggests fixes, and explains the why."
	},
	{
		id: 255,
		title: "Neon Street, Night",
		model: "Flux",
		category: "Photography",
		price: 8,
		sold: 2600,
		rating: 4.7,
		creator: "Kuro",
		aspect: "3/4",
		featured: 1,
		date: "2026-07-01",
		desc: "Rain-slick neon with real reflections and grain. That cyberpunk-on-a-budget look, nailed."
	},
	{
		id: 189,
		title: "Brand Voice, Bottled",
		model: "Claude",
		category: "Marketing",
		price: 24,
		sold: 860,
		rating: 4.9,
		creator: "Field & Co.",
		aspect: "4/3",
		featured: 0,
		date: "2026-06-15",
		desc: "Feed it three samples; get a reusable voice guide that writes anything in your exact tone."
	},
	{
		id: 211,
		title: "Anime Key Visual",
		model: "Midjourney",
		category: "Image",
		price: 15,
		sold: 3900,
		rating: 5,
		creator: "Sakuga",
		aspect: "2/3",
		featured: 1,
		date: "2026-06-24",
		desc: "Poster-grade key art with depth, rim light, and a real focal subject. Print at A2."
	},
	{
		id: 31,
		title: "The Socratic Tutor",
		model: "GPT-4o",
		category: "Research",
		price: 0,
		sold: 9200,
		rating: 4.7,
		creator: "J. Halloran",
		aspect: "5/4",
		featured: 1,
		date: "2026-05-14",
		desc: "Never hands you the answer. Leads you there with questions at exactly the right difficulty."
	},
	{
		id: 276,
		title: "Product Shot, White BG",
		model: "Flux",
		category: "Photography",
		price: 9,
		sold: 1500,
		rating: 4.8,
		creator: "Lumen",
		aspect: "1/1",
		featured: 0,
		date: "2026-07-02",
		desc: "Clean e-commerce hero shots with soft contact shadow. Drop-in ready for any storefront."
	},
	{
		id: 212,
		title: "The Worldbuilder's Bible",
		model: "GPT-4o",
		category: "Writing",
		price: 29,
		sold: 720,
		rating: 5,
		creator: "E. Castellanos",
		aspect: "4/5",
		featured: 0,
		date: "2026-06-25",
		desc: "Builds a consistent fictional world: geography, factions, history, and continuity rules."
	},
	{
		id: 248,
		title: "Vintage Film Poster",
		model: "Midjourney",
		category: "Design",
		price: 13,
		sold: 2200,
		rating: 4.9,
		creator: "Reel",
		aspect: "3/4",
		featured: 1,
		date: "2026-06-30",
		desc: "70s grain, bold type, halftone. One-sheets that look pulled from an archive."
	},
	{
		id: 156,
		title: "Bug-to-Test Generator",
		model: "GPT-4o",
		category: "Code",
		price: 15,
		sold: 1900,
		rating: 4.8,
		creator: "R. Mehta",
		aspect: "4/3",
		featured: 0,
		date: "2026-06-11",
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
		creator: "Lumen",
		aspect: "4/5",
		featured: 0,
		date: "2026-07-01",
		desc: "Creamy backgrounds, golden-hour warmth, eyes in razor focus. Pure mood."
	},
	{
		id: 101,
		title: "Meeting to Memo",
		model: "Claude",
		category: "Productivity",
		price: 6,
		sold: 5100,
		rating: 4.7,
		creator: "Ops Guild",
		aspect: "4/3",
		featured: 1,
		date: "2026-05-29",
		desc: "Turns a messy transcript into a crisp decision memo: owners, dates, and the one thing that matters."
	},
	{
		id: 290,
		title: "Concept Car, Studio",
		model: "Midjourney",
		category: "Image",
		price: 12,
		sold: 1400,
		rating: 4.8,
		creator: "Forme",
		aspect: "3/2",
		featured: 0,
		date: "2026-07-01",
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
		creator: "H. Mbeki",
		aspect: "1/1",
		featured: 0,
		date: "2026-05-22",
		desc: "Diagnoses why your story stalls and prescribes the fix: stakes, pacing, and the scene you are dodging."
	},
	{
		id: 221,
		title: "Watercolor Cityscape",
		model: "Flux",
		category: "Image",
		price: 9,
		sold: 2e3,
		rating: 4.9,
		creator: "Aquarelle",
		aspect: "3/4",
		featured: 0,
		date: "2026-06-27",
		desc: "Loose, luminous washes with confident linework. Soft skies, busy streets."
	},
	{
		id: 63,
		title: "Inbox Zero Strategist",
		model: "Claude",
		category: "Productivity",
		price: 8,
		sold: 3400,
		rating: 4.6,
		creator: "Lina P.",
		aspect: "4/3",
		featured: 1,
		date: "2026-05-20",
		desc: "Triage, draft, and schedule a full inbox in one pass, sorted by what moves your week."
	}
];
var users = [{
	id: 1,
	name: "Demo Buyer",
	email: "buyer@powerprompt.local"
}];
var seedFavorites = [
	207,
	301,
	31,
	101
];
var seedCart = [
	142,
	301,
	118
];
var orderSeeds = [
	{
		userId: 1,
		promptIds: [
			207,
			142,
			301
		],
		createdAt: "2026-07-01T10:15:00Z",
		status: "paid"
	},
	{
		userId: 1,
		promptIds: [31, 101],
		createdAt: "2026-07-02T12:20:00Z",
		status: "paid"
	},
	{
		userId: 1,
		promptIds: [
			211,
			255,
			248
		],
		createdAt: "2026-07-03T16:40:00Z",
		status: "paid"
	},
	{
		userId: 1,
		promptIds: [189, 160],
		createdAt: "2026-07-04T08:05:00Z",
		status: "paid"
	},
	{
		userId: 1,
		promptIds: [212, 156],
		createdAt: "2026-07-05T19:35:00Z",
		status: "paid"
	},
	{
		userId: 1,
		promptIds: [
			276,
			267,
			118
		],
		createdAt: "2026-07-06T11:10:00Z",
		status: "paid"
	}
];
//#endregion
//#region src/data/db.ts
var dataDir = path.join(process.cwd(), "data");
var dbPath = path.join(dataDir, "powerprompt.sqlite");
var userId = 1;
var SQL;
var db;
async function loadSql() {
	SQL ||= await initSqlJs({ locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file) });
	return SQL;
}
function rows(database, sql, params = {}) {
	const stmt = database.prepare(sql);
	stmt.bind(params);
	const out = [];
	while (stmt.step()) out.push(stmt.getAsObject());
	stmt.free();
	return out;
}
function one(database, sql, params = {}) {
	return rows(database, sql, params)[0];
}
function exec(database, sql, params = []) {
	const stmt = database.prepare(sql);
	stmt.run(params);
	stmt.free();
}
function save(database) {
	fs.mkdirSync(dataDir, { recursive: true });
	fs.writeFileSync(dbPath, Buffer.from(database.export()));
}
function createSchema(database) {
	database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS creators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      handle TEXT NOT NULL,
      avatar TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      creator_id INTEGER NOT NULL REFERENCES creators(id),
      price INTEGER NOT NULL,
      sold INTEGER NOT NULL,
      rating REAL NOT NULL,
      aspect TEXT NOT NULL,
      description TEXT NOT NULL,
      image_seed TEXT NOT NULL,
      featured INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL REFERENCES users(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id INTEGER NOT NULL REFERENCES users(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      subtotal INTEGER NOT NULL,
      platform_fee INTEGER NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      price INTEGER NOT NULL,
      creator_revenue REAL NOT NULL
    );
  `);
}
function seed(database) {
	if (one(database, "SELECT COUNT(*) AS total FROM prompts")?.total) return;
	categories.forEach((name) => exec(database, "INSERT INTO categories (name) VALUES (?)", [name]));
	creators.forEach((creator) => exec(database, "INSERT INTO creators (name, handle, avatar) VALUES (?, ?, ?)", [
		creator.name,
		creator.handle,
		creator.avatar
	]));
	users.forEach((user) => exec(database, "INSERT INTO users (id, name, email) VALUES (?, ?, ?)", [
		user.id,
		user.name,
		user.email
	]));
	prompts.forEach((prompt) => {
		exec(database, `INSERT INTO prompts
        (id, title, model, category_id, creator_id, price, sold, rating, aspect, description, image_seed, featured, created_at)
       VALUES (?, ?, ?, (SELECT id FROM categories WHERE name = ?), (SELECT id FROM creators WHERE name = ?), ?, ?, ?, ?, ?, ?, ?, ?)`, [
			prompt.id,
			prompt.title,
			prompt.model,
			prompt.category,
			prompt.creator,
			prompt.price,
			prompt.sold,
			prompt.rating,
			prompt.aspect,
			prompt.desc,
			`pp${prompt.id}`,
			prompt.featured,
			prompt.date
		]);
	});
	seedFavorites.forEach((promptId) => exec(database, "INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)", [userId, promptId]));
	seedCart.forEach((promptId) => exec(database, "INSERT INTO cart_items (user_id, prompt_id) VALUES (?, ?)", [userId, promptId]));
	orderSeeds.forEach((order) => {
		const subtotal = order.promptIds.reduce((sum, id) => sum + prompts.find((prompt) => prompt.id === id).price, 0);
		const fee = Math.round(subtotal * .08);
		exec(database, "INSERT INTO orders (user_id, subtotal, platform_fee, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
			order.userId,
			subtotal,
			fee,
			subtotal + fee,
			order.status,
			order.createdAt
		]);
		const orderId = one(database, "SELECT last_insert_rowid() AS id").id;
		order.promptIds.forEach((promptId) => {
			const price = prompts.find((prompt) => prompt.id === promptId).price;
			exec(database, "INSERT INTO order_items (order_id, prompt_id, price, creator_revenue) VALUES (?, ?, ?, ?)", [
				orderId,
				promptId,
				price,
				Math.round(price * .85 * 100) / 100
			]);
		});
	});
}
async function getDb() {
	if (db) return db;
	const SQLModule = await loadSql();
	fs.mkdirSync(dataDir, { recursive: true });
	db = fs.existsSync(dbPath) ? new SQLModule.Database(fs.readFileSync(dbPath)) : new SQLModule.Database();
	createSchema(db);
	seed(db);
	save(db);
	return db;
}
var promptSelect = `
  SELECT p.id, p.title, p.model, c.name AS category, cr.name AS creator, cr.handle AS creatorHandle,
    p.price, p.sold, p.rating, p.aspect, p.description, p.image_seed AS imageSeed,
    p.featured, p.created_at AS createdAt,
    CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS favorite,
    CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END AS inCart,
    ROUND((p.rating * 1000) + (p.sold * 0.18) + (p.featured * 650) + CASE WHEN p.price = 0 THEN 200 ELSE 0 END, 2) AS rankScore
  FROM prompts p
  JOIN categories c ON c.id = p.category_id
  JOIN creators cr ON cr.id = p.creator_id
  LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = $userId
  LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = $userId
`;
async function getCatalog(filters = {}) {
	const database = await getDb();
	const where = ["1 = 1"];
	const params = { $userId: userId };
	if (filters.model && filters.model !== "all") {
		where.push("p.model = $model");
		params.$model = filters.model;
	}
	if (filters.category && filters.category !== "all") {
		where.push("c.name = $category");
		params.$category = filters.category;
	}
	if (filters.search) {
		where.push("(LOWER(p.title || \" \" || p.model || \" \" || c.name || \" \" || p.description) LIKE $search)");
		params.$search = `%${filters.search.toLowerCase()}%`;
	}
	if (filters.favoritesOnly) where.push("f.prompt_id IS NOT NULL");
	if (filters.freeOnly) where.push("p.price = 0");
	const order = filters.sort === "newest" ? "datetime(p.created_at) DESC, p.id DESC" : filters.sort === "popular" ? "p.rating DESC, p.sold DESC" : "rankScore DESC, p.sold DESC";
	return rows(database, `${promptSelect} WHERE ${where.join(" AND ")} ORDER BY ${order}`, params);
}
async function getPrompt(id) {
	return one(await getDb(), `${promptSelect} WHERE p.id = $id`, {
		$id: id,
		$userId: userId
	});
}
async function getShellData() {
	const database = await getDb();
	return {
		categories: rows(database, `SELECT c.name, COUNT(p.id) AS promptCount FROM categories c LEFT JOIN prompts p ON p.category_id = c.id GROUP BY c.id ORDER BY c.id`),
		models: rows(database, "SELECT model, COUNT(*) AS promptCount FROM prompts GROUP BY model ORDER BY model"),
		counts: one(database, `SELECT
        (SELECT COUNT(*) FROM prompts) AS total,
        (SELECT COUNT(*) FROM prompts WHERE price = 0) AS free,
        (SELECT COUNT(*) FROM prompts WHERE price > 0) AS paid,
        (SELECT COUNT(*) FROM favorites WHERE user_id = $userId) AS favorites,
        (SELECT COUNT(*) FROM cart_items WHERE user_id = $userId) AS cart`, { $userId: userId })
	};
}
async function toggleFavorite(promptId) {
	const database = await getDb();
	const existing = one(database, "SELECT prompt_id FROM favorites WHERE user_id = $userId AND prompt_id = $promptId", {
		$userId: userId,
		$promptId: promptId
	});
	if (existing) exec(database, "DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?", [userId, promptId]);
	else exec(database, "INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)", [userId, promptId]);
	save(database);
	return { favorite: !existing };
}
async function addToCart(promptId) {
	const database = await getDb();
	exec(database, "INSERT OR IGNORE INTO cart_items (user_id, prompt_id) VALUES (?, ?)", [userId, promptId]);
	save(database);
	return getCart();
}
async function removeFromCart(promptId) {
	const database = await getDb();
	exec(database, "DELETE FROM cart_items WHERE user_id = ? AND prompt_id = ?", [userId, promptId]);
	save(database);
	return getCart();
}
async function getCart() {
	const database = await getDb();
	return {
		items: rows(database, `${promptSelect} WHERE ci.user_id = $userId ORDER BY ci.created_at DESC`, { $userId: userId }),
		totals: one(database, `SELECT
      COALESCE(SUM(p.price), 0) AS subtotal,
      ROUND(COALESCE(SUM(p.price), 0) * 0.08) AS platformFee,
      COALESCE(SUM(p.price), 0) + ROUND(COALESCE(SUM(p.price), 0) * 0.08) AS total,
      COUNT(*) AS itemCount
    FROM cart_items ci
    JOIN prompts p ON p.id = ci.prompt_id
    WHERE ci.user_id = $userId`, { $userId: userId })
	};
}
async function checkout() {
	const database = await getDb();
	const cart = await getCart();
	if (!cart.items.length) return {
		ok: false,
		orderId: null,
		cart
	};
	exec(database, "INSERT INTO orders (user_id, subtotal, platform_fee, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
		userId,
		cart.totals.subtotal,
		cart.totals.platformFee,
		cart.totals.total,
		"paid",
		(/* @__PURE__ */ new Date()).toISOString()
	]);
	const orderId = one(database, "SELECT last_insert_rowid() AS id").id;
	cart.items.forEach((item) => {
		exec(database, "INSERT INTO order_items (order_id, prompt_id, price, creator_revenue) VALUES (?, ?, ?, ?)", [
			orderId,
			item.id,
			item.price,
			Math.round(item.price * .85 * 100) / 100
		]);
	});
	exec(database, "DELETE FROM cart_items WHERE user_id = ?", [userId]);
	save(database);
	return {
		ok: true,
		orderId,
		cart: await getCart()
	};
}
async function getAnalytics() {
	const database = await getDb();
	return {
		summary: one(database, `SELECT
        COALESCE(SUM(o.total), 0) AS revenue,
        COUNT(DISTINCT o.id) AS orders,
        ROUND(COALESCE(AVG(o.total), 0), 2) AS averageOrderValue,
        ROUND(COUNT(DISTINCT o.id) * 1.0 / (SELECT COUNT(*) FROM prompts), 3) AS conversionRate,
        ROUND((SELECT AVG(price) FROM prompts WHERE price > 0), 2) AS averagePrice
       FROM orders o
       WHERE o.status = 'paid'`),
		creators: rows(database, `SELECT cr.name, cr.handle, ROUND(COALESCE(SUM(oi.creator_revenue), 0), 2) AS creatorRevenue,
        COUNT(oi.id) AS sales, ROUND(AVG(p.rating), 2) AS averageRating
       FROM creators cr
       JOIN prompts p ON p.creator_id = cr.id
       LEFT JOIN order_items oi ON oi.prompt_id = p.id
       GROUP BY cr.id
       ORDER BY creatorRevenue DESC, sales DESC
       LIMIT 8`),
		categories: rows(database, `SELECT c.name, ROUND(COALESCE(SUM(oi.price), 0), 2) AS categoryRevenue, COUNT(oi.id) AS sales
       FROM categories c
       JOIN prompts p ON p.category_id = c.id
       LEFT JOIN order_items oi ON oi.prompt_id = p.id
       GROUP BY c.id
       ORDER BY categoryRevenue DESC`),
		daily: rows(database, `SELECT date(created_at) AS day, SUM(total) AS revenue, COUNT(*) AS orders
       FROM orders
       WHERE status = 'paid'
       GROUP BY date(created_at)
       ORDER BY day ASC`)
	};
}
//#endregion
//#region src/market-api.ts
var api = {
	shell: () => getShellData(),
	catalog: (filters) => getCatalog(filters),
	prompt: (id) => getPrompt(id),
	cart: () => getCart(),
	toggleFavorite: (id) => toggleFavorite(id),
	addToCart: (id) => addToCart(id),
	removeFromCart: (id) => removeFromCart(id),
	checkout: () => checkout(),
	analytics: () => getAnalytics()
};
createServerFn({ method: "GET" }).handler(createSsrRpc("6c88d92654009af4df6f200ba557f2e59964699bbf78ca8d1a59a3f67b24604b"));
createServerFn({ method: "GET" }).validator((data) => data).handler(createSsrRpc("4662c0b73fe0a9783023e807eb7384c0902158b0e2bc225a7975277edf55a6ec"));
createServerFn({ method: "GET" }).validator((id) => id).handler(createSsrRpc("de7438bb4ad16e1b4fd6213f4d7ba04d244651fa78a03545629fb1289b05dadc"));
createServerFn({ method: "GET" }).handler(createSsrRpc("a488e323066318809b92eb79c78e8a6f30e36a4bf1cc6a7487e05e6babebe3e9"));
var toggleFavoriteServer = createServerFn({ method: "POST" }).validator((id) => id).handler(createSsrRpc("972a6cbd7417cec489191f1d360541f4f610c5ea7689449adddf1c5ae6c6d6f9"));
var addToCartServer = createServerFn({ method: "POST" }).validator((id) => id).handler(createSsrRpc("a55e4fe6a14bcc554d9a591c938ced9f09c671433c2f9fdcd4dca9ffbaed9b28"));
var removeFromCartServer = createServerFn({ method: "POST" }).validator((id) => id).handler(createSsrRpc("94df2b8008894d4e95d45a38bd73a98de586fbd733aa599bea291b8338421df7"));
var checkoutServer = createServerFn({ method: "POST" }).handler(createSsrRpc("3a7e959366a8905b1ab3bbd7320d222de122ca298cbd7839d16d1a53e07d939e"));
createServerFn({ method: "GET" }).handler(createSsrRpc("aa0871f15d275868aa2daa945c6b029139b71b6f5d31519b415e96c02c7dcef5"));
//#endregion
export { toggleFavoriteServer as a, removeFromCartServer as i, api as n, checkoutServer as r, addToCartServer as t };
