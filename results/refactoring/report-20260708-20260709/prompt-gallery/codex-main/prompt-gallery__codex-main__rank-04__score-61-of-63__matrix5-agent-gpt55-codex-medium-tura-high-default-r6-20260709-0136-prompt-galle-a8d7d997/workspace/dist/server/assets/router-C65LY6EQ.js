import { t as ToastProvider } from "./useToast-DprI_C5-.js";
import { t as Route$6 } from "./cart-DKJFx6gC.js";
import { t as Route$7 } from "./admin-xZo6KPD8.js";
import { t as Route$8 } from "./routes-Dfa7LDHW.js";
import { t as Route$9 } from "./prompts._promptId-DKiH2lDm.js";
import { HeadContent, Outlet, Scripts, createFileRoute, createRootRoute, createRouter as createRouter$1 } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
//#region src/styles/app.css?url
var app_default = "/assets/app-1-i8MGcC.css";
//#endregion
//#region src/routes/__root.tsx
var Route$5 = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: "POWERPROMPT - Prompt Gallery" },
			{
				name: "description",
				content: "A full-stack TanStack Start prompt marketplace."
			}
		],
		links: [{
			rel: "stylesheet",
			href: app_default
		}]
	}),
	component: Root
});
function Root() {
	return /* @__PURE__ */ jsxs("html", {
		lang: "en",
		children: [/* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }), /* @__PURE__ */ jsxs("body", { children: [/* @__PURE__ */ jsx(ToastProvider, { children: /* @__PURE__ */ jsx(Outlet, {}) }), /* @__PURE__ */ jsx(Scripts, {})] })]
	});
}
//#endregion
//#region src/server/seed.ts
var creators = [
	{
		id: 1,
		name: "Atlas Studio",
		handle: "atlas",
		commissionRate: .85
	},
	{
		id: 2,
		name: "Lumen",
		handle: "lumen",
		commissionRate: .85
	},
	{
		id: 3,
		name: "Field & Co.",
		handle: "field",
		commissionRate: .85
	},
	{
		id: 4,
		name: "Ops Guild",
		handle: "ops",
		commissionRate: .85
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
	[
		207,
		"Cinematic Still, 35mm",
		"Midjourney",
		"Image",
		9,
		4700,
		5,
		1,
		"3/4",
		"Film-grade stills with real lens language, focal length, grain, and lighting that reads as cinema.",
		1,
		"2026-06-27"
	],
	[
		233,
		"Ink Wash Warrior",
		"Midjourney",
		"Image",
		12,
		2100,
		4.9,
		1,
		"2/3",
		"Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space.",
		1,
		"2026-06-30"
	],
	[
		174,
		"Editorial Photo Grade",
		"Flux",
		"Photography",
		11,
		1300,
		4.9,
		2,
		"3/4",
		"Magazine-style color grading with warm skin, deep shadow, and a quiet print look.",
		0,
		"2026-07-01"
	],
	[
		301,
		"Magazine Cover Maker",
		"GPT-4o",
		"Design",
		14,
		3300,
		4.8,
		3,
		"4/5",
		"Drop in a photo, get a full cover: masthead, cover lines, barcode, the works.",
		1,
		"2026-07-07"
	],
	[
		118,
		"Studio Portrait, Soft Light",
		"Flux",
		"Photography",
		10,
		1800,
		4.9,
		2,
		"4/5",
		"Clean beauty light with believable falloff. Looks shot, not rendered.",
		1,
		"2026-06-26"
	],
	[
		198,
		"Logo Sketch, Mono-line",
		"Midjourney",
		"Design",
		13,
		980,
		4.8,
		3,
		"1/1",
		"Single-weight line marks with real negative-space thinking. Vector-ready directions, fast.",
		0,
		"2026-07-02"
	],
	[
		142,
		"The Cold-Email Closer",
		"GPT-4o",
		"Marketing",
		12,
		2300,
		4.9,
		3,
		"4/3",
		"Cold emails that actually get replies with tested subject-line variants baked in.",
		1,
		"2026-07-04"
	],
	[
		160,
		"Senior Code Reviewer",
		"Claude",
		"Code",
		18,
		1100,
		4.8,
		4,
		"1/1",
		"Reviews your diff like a staff engineer, catches risk, suggests fixes, explains the why.",
		0,
		"2026-07-03"
	],
	[
		255,
		"Neon Street, Night",
		"Flux",
		"Photography",
		8,
		2600,
		4.7,
		2,
		"3/4",
		"Rain-slick neon with real reflections and grain. A cinematic night street look.",
		1,
		"2026-07-05"
	],
	[
		189,
		"Brand Voice, Bottled",
		"Claude",
		"Marketing",
		24,
		860,
		4.9,
		3,
		"4/3",
		"Feed it three samples; get a reusable voice guide that writes in your exact tone.",
		1,
		"2026-06-29"
	],
	[
		211,
		"Anime Key Visual",
		"Midjourney",
		"Image",
		15,
		3900,
		5,
		1,
		"2/3",
		"Poster-grade key art with depth, rim light, and a real focal subject.",
		1,
		"2026-07-06"
	],
	[
		31,
		"The Socratic Tutor",
		"GPT-4o",
		"Research",
		0,
		9200,
		4.7,
		4,
		"5/4",
		"Never hands you the answer. Leads you there with questions at the right difficulty.",
		1,
		"2026-06-24"
	],
	[
		276,
		"Product Shot, White BG",
		"Flux",
		"Photography",
		9,
		1500,
		4.8,
		2,
		"1/1",
		"Clean e-commerce hero shots with soft contact shadow. Drop-in ready for storefronts.",
		0,
		"2026-07-08"
	],
	[
		212,
		"The Worldbuilder's Bible",
		"GPT-4o",
		"Writing",
		29,
		720,
		5,
		4,
		"4/5",
		"Builds a consistent fictional world: geography, factions, history, and continuity.",
		1,
		"2026-06-28"
	],
	[
		248,
		"Vintage Film Poster",
		"Midjourney",
		"Design",
		13,
		2200,
		4.9,
		3,
		"3/4",
		"70s grain, bold type, halftone. One-sheets that look pulled from an archive.",
		1,
		"2026-07-01"
	],
	[
		156,
		"Bug-to-Test Generator",
		"GPT-4o",
		"Code",
		15,
		1900,
		4.8,
		4,
		"4/3",
		"Paste a bug report, get a failing test plus the fix and edge cases.",
		0,
		"2026-07-06"
	],
	[
		267,
		"Dreamy Bokeh Portrait",
		"Flux",
		"Photography",
		10,
		1700,
		4.8,
		2,
		"4/5",
		"Creamy backgrounds, golden-hour warmth, eyes in razor focus.",
		1,
		"2026-07-03"
	],
	[
		101,
		"Meeting -> Memo",
		"Claude",
		"Productivity",
		6,
		5100,
		4.7,
		4,
		"4/3",
		"Turns a messy transcript into a crisp decision memo: owners, dates, and next steps.",
		1,
		"2026-07-02"
	]
];
var orderSeed = [
	[
		"2026-07-01",
		207,
		9,
		12
	],
	[
		"2026-07-01",
		31,
		0,
		30
	],
	[
		"2026-07-02",
		101,
		6,
		18
	],
	[
		"2026-07-02",
		142,
		12,
		10
	],
	[
		"2026-07-03",
		160,
		18,
		7
	],
	[
		"2026-07-03",
		267,
		10,
		11
	],
	[
		"2026-07-04",
		211,
		15,
		16
	],
	[
		"2026-07-05",
		255,
		8,
		20
	],
	[
		"2026-07-06",
		301,
		14,
		14
	],
	[
		"2026-07-06",
		156,
		15,
		9
	],
	[
		"2026-07-07",
		189,
		24,
		6
	],
	[
		"2026-07-08",
		276,
		9,
		12
	]
];
//#endregion
//#region src/server/db.ts
var dbPath = path.join(process.cwd(), "data", "powerprompt.sqlite");
var db;
function getDb() {
	if (!db) {
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		db = new DatabaseSync(dbPath);
		db.exec("PRAGMA journal_mode = WAL");
		migrate(db);
		seed(db);
	}
	return db;
}
function migrate(conn) {
	conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creators (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      commission_rate REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      price REAL NOT NULL,
      sold INTEGER NOT NULL,
      rating REAL NOT NULL,
      creator_id INTEGER NOT NULL REFERENCES creators(id),
      aspect_ratio TEXT NOT NULL,
      description TEXT NOT NULL,
      featured INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      prompt_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id INTEGER NOT NULL,
      prompt_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ordered_at TEXT NOT NULL,
      subtotal REAL NOT NULL,
      fee REAL NOT NULL,
      total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id INTEGER REFERENCES prompts(id),
      visited_at TEXT NOT NULL
    );
  `);
}
function seed(conn) {
	if (conn.prepare("SELECT COUNT(*) as c FROM prompts").get().c > 0) return;
	const insert = () => {
		conn.exec("BEGIN");
		try {
			conn.prepare("INSERT INTO users (id, name) VALUES (1, ?)").run("Demo buyer");
			const catStmt = conn.prepare("INSERT INTO categories (id, name) VALUES (?, ?)");
			categories.forEach((name, index) => catStmt.run(index + 1, name));
			const creatorStmt = conn.prepare("INSERT INTO creators (id, name, handle, commission_rate) VALUES (?, ?, ?, ?)");
			creators.forEach((c) => creatorStmt.run(c.id, c.name, c.handle, c.commissionRate));
			const promptStmt = conn.prepare(`
      INSERT INTO prompts
      (id, title, model, category_id, price, sold, rating, creator_id, aspect_ratio, description, featured, created_at)
      VALUES (?, ?, ?, (SELECT id FROM categories WHERE name = ?), ?, ?, ?, ?, ?, ?, ?, ?)
    `);
			prompts.forEach((p) => promptStmt.run(...p));
			conn.prepare("INSERT INTO favorites (user_id, prompt_id) VALUES (1, 31), (1, 211), (1, 301)").run();
			conn.prepare("INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (1, 207, 1), (1, 142, 1)").run();
			const orderStmt = conn.prepare("INSERT INTO orders (user_id, ordered_at, subtotal, fee, total) VALUES (1, ?, ?, ?, ?)");
			const itemStmt = conn.prepare("INSERT INTO order_items (order_id, prompt_id, quantity, unit_price) VALUES (?, ?, ?, ?)");
			orderSeed.forEach(([day, promptId, price, quantity]) => {
				const subtotal = Number(price) * Number(quantity);
				const fee = Math.round(subtotal * .06 * 100) / 100;
				const info = orderStmt.run(day, subtotal, fee, subtotal + fee);
				itemStmt.run(info.lastInsertRowid, promptId, quantity, price);
			});
			const visitStmt = conn.prepare("INSERT INTO visits (prompt_id, visited_at) VALUES (?, ?)");
			prompts.forEach((p, index) => {
				const repeat = 25 + Number(p[5]) % 50;
				for (let i = 0; i < repeat; i++) visitStmt.run(p[0], `2026-07-0${index % 8 + 1}`);
			});
			conn.exec("COMMIT");
		} catch (error) {
			conn.exec("ROLLBACK");
			throw error;
		}
	};
	insert();
}
function imageUrl(id, aspectRatio) {
	const [w, h] = aspectRatio.split("/").map(Number);
	const width = 640;
	return `https://picsum.photos/seed/powerprompt-${id}/${width}/${Math.round(width * h / w)}`;
}
function listCategories() {
	return getDb().prepare(`SELECT c.name, COUNT(p.id) count
       FROM categories c LEFT JOIN prompts p ON p.category_id = c.id
       GROUP BY c.id ORDER BY c.id`).all();
}
function listPrompts(input = {}) {
	const userId = input.userId ?? 1;
	const model = input.model ?? "all";
	const category = input.category ?? "all";
	const search = `%${(input.search ?? "").toLowerCase()}%`;
	const favOnly = input.favoritesOnly ? 1 : 0;
	const freeOnly = input.freeOnly ? 1 : 0;
	const sortSql = input.sort === "newest" ? "p.created_at DESC, p.id DESC" : input.sort === "popular" ? "p.rating DESC, p.sold DESC" : "rankScore DESC, p.featured DESC";
	return getDb().prepare(`
      SELECT p.id, p.title, p.model, c.name category, p.price, p.sold, p.rating,
        cr.name creator, cr.id creatorId, p.aspect_ratio aspectRatio, p.description,
        p.featured, p.created_at createdAt,
        ROUND((p.rating * 20) + (p.sold / 120.0) + (p.featured * 35) - (p.price * 0.28), 2) rankScore,
        CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END isFavorite,
        CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END inCart
      FROM prompts p
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
      LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = ?
      WHERE (? = 'all' OR p.model = ?)
        AND (? = 'all' OR c.name = ?)
        AND (? = 0 OR p.price = 0)
        AND (? = 0 OR f.prompt_id IS NOT NULL)
        AND (LOWER(p.title || ' ' || p.model || ' ' || c.name || ' ' || p.description || ' ' || cr.name) LIKE ?)
      ORDER BY ${sortSql}
    `).all(userId, userId, model, model, category, category, freeOnly, favOnly, search).map((row) => ({
		...row,
		imageUrl: imageUrl(row.id, row.aspectRatio)
	}));
}
function getPrompt(id, userId = 1) {
	return listPrompts({ userId }).find((prompt) => prompt.id === id) ?? null;
}
function toggleFavorite(promptId, userId = 1) {
	const conn = getDb();
	if (conn.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND prompt_id = ?").get(userId, promptId)) {
		conn.prepare("DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?").run(userId, promptId);
		return { favorited: false };
	}
	conn.prepare("INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)").run(userId, promptId);
	return { favorited: true };
}
function addCartItem(promptId, userId = 1) {
	getDb().prepare(`INSERT INTO cart_items (user_id, prompt_id, quantity)
       VALUES (?, ?, 1)
       ON CONFLICT(user_id, prompt_id) DO UPDATE SET quantity = quantity + 1`).run(userId, promptId);
	return getCart(userId);
}
function removeCartItem(promptId, userId = 1) {
	getDb().prepare("DELETE FROM cart_items WHERE user_id = ? AND prompt_id = ?").run(userId, promptId);
	return getCart(userId);
}
function getCart(userId = 1) {
	const items = getDb().prepare(`
      SELECT p.id, p.title, p.model, c.name category, p.price, ci.quantity,
        cr.name creator, p.aspect_ratio aspectRatio,
        ROUND(p.price * ci.quantity, 2) lineTotal
      FROM cart_items ci
      JOIN prompts p ON p.id = ci.prompt_id
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      WHERE ci.user_id = ?
      ORDER BY ci.created_at DESC
    `).all(userId);
	const totalRow = getDb().prepare(`
      SELECT
        ROUND(COALESCE(SUM(p.price * ci.quantity), 0), 2) subtotal,
        ROUND(COALESCE(SUM(p.price * ci.quantity), 0) * 0.06, 2) fee,
        ROUND(COALESCE(SUM(p.price * ci.quantity), 0) * 1.06, 2) total,
        COALESCE(SUM(ci.quantity), 0) count
      FROM cart_items ci JOIN prompts p ON p.id = ci.prompt_id
      WHERE ci.user_id = ?
    `).get(userId);
	return {
		items: items.map((item) => ({
			...item,
			imageUrl: imageUrl(item.id, item.aspectRatio)
		})),
		totals: totalRow
	};
}
function checkout(userId = 1) {
	const cart = getCart(userId);
	if (cart.items.length === 0) return {
		ok: false,
		message: "Cart is empty",
		orderId: null,
		cart
	};
	const conn = getDb();
	const tx = () => {
		conn.exec("BEGIN");
		try {
			const order = conn.prepare("INSERT INTO orders (user_id, ordered_at, subtotal, fee, total) VALUES (?, date('now'), ?, ?, ?)").run(userId, cart.totals.subtotal, cart.totals.fee, cart.totals.total);
			const itemStmt = conn.prepare("INSERT INTO order_items (order_id, prompt_id, quantity, unit_price) VALUES (?, ?, ?, ?)");
			cart.items.forEach((item) => itemStmt.run(order.lastInsertRowid, item.id, item.quantity, item.price));
			conn.prepare("DELETE FROM cart_items WHERE user_id = ?").run(userId);
			conn.exec("COMMIT");
			return Number(order.lastInsertRowid);
		} catch (error) {
			conn.exec("ROLLBACK");
			throw error;
		}
	};
	return {
		ok: true,
		message: "Checkout complete",
		orderId: tx(),
		cart: getCart(userId)
	};
}
function analytics() {
	const conn = getDb();
	return {
		summary: conn.prepare(`
      SELECT
        COUNT(DISTINCT o.id) orders,
        ROUND(SUM(o.total), 2) grossRevenue,
        ROUND(AVG(o.total), 2) averageOrderValue,
        (SELECT COUNT(*) FROM visits) visits,
        ROUND(COUNT(DISTINCT o.id) * 100.0 / (SELECT COUNT(*) FROM visits), 2) conversionRate
      FROM orders o
    `).get(),
		creators: conn.prepare(`
      SELECT cr.name, cr.handle,
        ROUND(SUM(oi.quantity * oi.unit_price), 2) gross,
        ROUND(SUM(oi.quantity * oi.unit_price * cr.commission_rate), 2) creatorRevenue,
        SUM(oi.quantity) units
      FROM order_items oi
      JOIN prompts p ON p.id = oi.prompt_id
      JOIN creators cr ON cr.id = p.creator_id
      GROUP BY cr.id
      ORDER BY creatorRevenue DESC
    `).all(),
		categories: conn.prepare(`
      SELECT c.name, ROUND(SUM(oi.quantity * oi.unit_price), 2) revenue, SUM(oi.quantity) units
      FROM order_items oi
      JOIN prompts p ON p.id = oi.prompt_id
      JOIN categories c ON c.id = p.category_id
      GROUP BY c.id ORDER BY revenue DESC
    `).all(),
		daily: conn.prepare(`
      SELECT ordered_at day, ROUND(SUM(total), 2) revenue, COUNT(*) orders
      FROM orders GROUP BY ordered_at ORDER BY ordered_at
    `).all(),
		modelMix: conn.prepare(`
      SELECT p.model, SUM(oi.quantity) units, ROUND(SUM(oi.quantity * oi.unit_price), 2) revenue
      FROM order_items oi JOIN prompts p ON p.id = oi.prompt_id
      GROUP BY p.model ORDER BY revenue DESC
    `).all()
	};
}
//#endregion
//#region src/server/api.ts
function storefrontApi(input = {}) {
	return {
		prompts: listPrompts(input),
		categories: listCategories(),
		cart: getCart()
	};
}
function promptDetailApi(id) {
	return {
		prompt: getPrompt(id),
		cart: getCart()
	};
}
var cartApi = () => getCart();
var analyticsApi = () => analytics();
var favoriteApi = (promptId) => toggleFavorite(promptId);
var addCartApi = (promptId) => addCartItem(promptId);
var removeCartApi = (promptId) => removeCartItem(promptId);
var checkoutApi = () => checkout();
//#endregion
//#region src/routes/api.storefront.tsx
var Route$4 = createFileRoute("/api/storefront")({ server: { handlers: { GET: ({ request }) => {
	const url = new URL(request.url);
	const data = storefrontApi({
		model: url.searchParams.get("model") ?? "all",
		category: url.searchParams.get("category") ?? "all",
		sort: url.searchParams.get("sort") ?? "featured",
		search: url.searchParams.get("search") ?? "",
		favoritesOnly: url.searchParams.get("favoritesOnly") === "true",
		freeOnly: url.searchParams.get("freeOnly") === "true"
	});
	return Response.json(data);
} } } });
//#endregion
//#region src/routes/api.favorite.tsx
var Route$3 = createFileRoute("/api/favorite")({ server: { handlers: { POST: async ({ request }) => {
	const body = await request.json();
	return Response.json(favoriteApi(Number(body.promptId)));
} } } });
//#endregion
//#region src/routes/api.cart.tsx
var Route$2 = createFileRoute("/api/cart")({ server: { handlers: {
	GET: () => Response.json({
		cart: cartApi(),
		categories: storefrontApi().categories
	}),
	POST: async ({ request }) => {
		const body = await request.json().catch(() => ({}));
		if (body.action === "add") return Response.json(addCartApi(Number(body.promptId)));
		if (body.action === "remove") return Response.json(removeCartApi(Number(body.promptId)));
		if (body.action === "checkout") return Response.json(checkoutApi());
		return new Response("Unknown cart action", { status: 400 });
	}
} } });
//#endregion
//#region src/routes/api.analytics.tsx
var Route$1 = createFileRoute("/api/analytics")({ server: { handlers: { GET: () => Response.json({
	analytics: analyticsApi(),
	categories: storefrontApi().categories,
	cart: storefrontApi().cart
}) } } });
//#endregion
//#region src/routes/api.prompt.$promptId.tsx
var Route = createFileRoute("/api/prompt/$promptId")({ server: { handlers: { GET: ({ params }) => {
	const detail = promptDetailApi(Number(params.promptId));
	return Response.json({
		...detail,
		categories: storefrontApi().categories
	});
} } } });
//#endregion
//#region src/routeTree.gen.ts
var CartRoute = Route$6.update({
	id: "/cart",
	path: "/cart",
	getParentRoute: () => Route$5
});
var AdminRoute = Route$7.update({
	id: "/admin",
	path: "/admin",
	getParentRoute: () => Route$5
});
var IndexRoute = Route$8.update({
	id: "/",
	path: "/",
	getParentRoute: () => Route$5
});
var PromptsPromptIdRoute = Route$9.update({
	id: "/prompts/$promptId",
	path: "/prompts/$promptId",
	getParentRoute: () => Route$5
});
var ApiStorefrontRoute = Route$4.update({
	id: "/api/storefront",
	path: "/api/storefront",
	getParentRoute: () => Route$5
});
var ApiFavoriteRoute = Route$3.update({
	id: "/api/favorite",
	path: "/api/favorite",
	getParentRoute: () => Route$5
});
var ApiCartRoute = Route$2.update({
	id: "/api/cart",
	path: "/api/cart",
	getParentRoute: () => Route$5
});
var rootRouteChildren = {
	IndexRoute,
	AdminRoute,
	CartRoute,
	ApiAnalyticsRoute: Route$1.update({
		id: "/api/analytics",
		path: "/api/analytics",
		getParentRoute: () => Route$5
	}),
	ApiCartRoute,
	ApiFavoriteRoute,
	ApiStorefrontRoute,
	PromptsPromptIdRoute,
	ApiPromptPromptIdRoute: Route.update({
		id: "/api/prompt/$promptId",
		path: "/api/prompt/$promptId",
		getParentRoute: () => Route$5
	})
};
var routeTree = Route$5._addFileChildren(rootRouteChildren)._addFileTypes();
//#endregion
//#region src/router.tsx
function createRouter() {
	return createRouter$1({
		routeTree,
		defaultPreload: "intent",
		scrollRestoration: true
	});
}
var getRouter = createRouter;
//#endregion
export { favoriteApi as a, storefrontApi as c, createRouter, getRouter, checkoutApi as i, analyticsApi as n, promptDetailApi as o, cartApi as r, removeCartApi as s, addCartApi as t };
