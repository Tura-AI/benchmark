import { n as TSS_SERVER_FUNCTION, t as createServerFn } from "../server.js";
import { c as userId, n as categories } from "./seed-FYamb1wu.js";
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
//#region src/server/queries.ts?tss-serverfn-split
async function dbAccess() {
	return import("./db-__xlAmJX.js");
}
var orderBy = {
	featured: "p.featured DESC, rankScore DESC, p.sold DESC",
	newest: "p.created_at DESC, p.id DESC",
	popular: "p.rating DESC, p.sold DESC"
};
function imageUrl(id, aspect) {
	const [w, h] = aspect.split("/").map(Number);
	const width = 640;
	return `https://picsum.photos/seed/pp${id}/${width}/${Math.round(width * h / w)}`;
}
function normalizePrompt(row) {
	return {
		...row,
		imageUrl: imageUrl(row.id, row.aspect)
	};
}
async function getCatalog(filters = {}) {
	const { getDb, sql } = await dbAccess();
	const db = await getDb();
	const where = ["1=1"];
	const params = [userId, userId];
	if (filters.model && filters.model !== "all") {
		where.push("p.model = ?");
		params.push(filters.model);
	}
	if (filters.category && filters.category !== "all") {
		where.push("p.category = ?");
		params.push(filters.category);
	}
	if (filters.q) {
		where.push("(LOWER(p.title || \" \" || p.model || \" \" || p.category || \" \" || p.description) LIKE ?)");
		params.push(`%${filters.q.toLowerCase()}%`);
	}
	if (filters.favoritesOnly) where.push("f.prompt_id IS NOT NULL");
	if (filters.freeOnly) where.push("p.price = 0");
	const rows = sql.all(db, `SELECT p.id, p.title, p.model, p.category, p.price, p.sold, p.rating,
      p.creator_id AS creatorId, c.name AS creator, c.handle, p.aspect, p.featured,
      p.created_at AS createdAt, p.description,
      ROUND((p.rating * 1000) + (p.sold * 0.08) + (p.featured * 850) - (p.price * 4), 2) AS rankScore,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS isFavorite,
      CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END AS inCart
    FROM prompts p
    JOIN creators c ON c.id = p.creator_id
    LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
    LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = ?
    WHERE ${where.join(" AND ")}
    ORDER BY ${orderBy[filters.sort ?? "featured"]}`, params);
	const counts = sql.first(db, `SELECT COUNT(*) AS total,
      SUM(CASE WHEN price = 0 THEN 1 ELSE 0 END) AS free,
      SUM(CASE WHEN price > 0 THEN 1 ELSE 0 END) AS paid,
      SUM(featured) AS featured
     FROM prompts`) ?? {
		total: 0,
		free: 0,
		paid: 0,
		featured: 0
	};
	return {
		prompts: rows.map(normalizePrompt),
		categories,
		counts
	};
}
async function getPrompt(id) {
	const { getDb, sql } = await dbAccess();
	const db = await getDb();
	const prompt = sql.first(db, `SELECT p.id, p.title, p.model, p.category, p.price, p.sold, p.rating,
      p.creator_id AS creatorId, c.name AS creator, c.handle, p.aspect, p.featured,
      p.created_at AS createdAt, p.description,
      ROUND((p.rating * 1000) + (p.sold * 0.08) + (p.featured * 850) - (p.price * 4), 2) AS rankScore,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS isFavorite,
      CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END AS inCart
     FROM prompts p
     JOIN creators c ON c.id = p.creator_id
     LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
     LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = ?
     WHERE p.id = ?`, [
		userId,
		userId,
		id
	]);
	return prompt ? normalizePrompt(prompt) : null;
}
async function getCart() {
	const { getDb, sql } = await dbAccess();
	const db = await getDb();
	return {
		items: sql.all(db, `SELECT p.id, p.title, p.model, p.category, p.price, p.sold, p.rating,
      p.creator_id AS creatorId, c.name AS creator, c.handle, p.aspect, p.featured,
      p.created_at AS createdAt, p.description, ci.quantity,
      ROUND((p.rating * 1000) + (p.sold * 0.08) + (p.featured * 850) - (p.price * 4), 2) AS rankScore,
      1 AS inCart,
      CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END AS isFavorite,
      ROUND(p.price * ci.quantity, 2) AS lineTotal
     FROM cart_items ci
     JOIN prompts p ON p.id = ci.prompt_id
     JOIN creators c ON c.id = p.creator_id
     LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ci.user_id
     WHERE ci.user_id = ?
     ORDER BY p.created_at DESC`, [userId]).map((row) => ({
			...row,
			imageUrl: imageUrl(row.id, row.aspect)
		})),
		totals: sql.first(db, `SELECT ROUND(COALESCE(SUM(p.price * ci.quantity), 0), 2) AS subtotal,
      ROUND(COALESCE(SUM(p.price * ci.quantity), 0) * 0.1, 2) AS fee,
      ROUND(COALESCE(SUM(p.price * ci.quantity), 0) * 1.1, 2) AS total,
      COALESCE(SUM(ci.quantity), 0) AS itemCount
     FROM cart_items ci
     JOIN prompts p ON p.id = ci.prompt_id
     WHERE ci.user_id = ?`, ["user_demo"]) ?? {
			subtotal: 0,
			fee: 0,
			total: 0,
			itemCount: 0
		}
	};
}
async function toggleFavorite(promptId) {
	const { getDb, sql } = await dbAccess();
	const db = await getDb();
	if (sql.first(db, "SELECT prompt_id AS promptId FROM favorites WHERE user_id = ? AND prompt_id = ?", ["user_demo", promptId])) {
		sql.run(db, "DELETE FROM favorites WHERE user_id = ? AND prompt_id = ?", [userId, promptId]);
		sql.persist(db);
		return { isFavorite: false };
	}
	sql.run(db, "INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)", [userId, promptId]);
	sql.persist(db);
	return { isFavorite: true };
}
async function addToCart(promptId) {
	const { getDb, sql } = await dbAccess();
	const db = await getDb();
	sql.run(db, `INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (?, ?, 1)
     ON CONFLICT(user_id, prompt_id) DO UPDATE SET quantity = quantity + 1`, [userId, promptId]);
	sql.persist(db);
	return getCart();
}
async function checkoutCart() {
	const { getDb, sql } = await dbAccess();
	const db = await getDb();
	const cart = await getCart();
	if (cart.totals.itemCount === 0) return {
		ok: false,
		orderId: null,
		...cart
	};
	const orderId = `ord_${Date.now()}`;
	const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
	sql.run(db, "INSERT INTO orders (id, user_id, created_at, subtotal, fee, total) VALUES (?, ?, ?, ?, ?, ?)", [
		orderId,
		userId,
		today,
		cart.totals.subtotal,
		cart.totals.fee,
		cart.totals.total
	]);
	for (const item of cart.items) sql.run(db, "INSERT INTO order_items (order_id, prompt_id, quantity, price) VALUES (?, ?, ?, ?)", [
		orderId,
		item.id,
		item.quantity,
		item.price
	]);
	sql.run(db, "DELETE FROM cart_items WHERE user_id = ?", [userId]);
	sql.persist(db);
	return {
		ok: true,
		orderId,
		...await getCart()
	};
}
async function getAnalytics() {
	const { getDb, sql } = await dbAccess();
	const db = await getDb();
	return {
		overview: sql.first(db, `SELECT ROUND(SUM(total), 2) AS revenue,
      COUNT(*) AS orders,
      ROUND(AVG(total), 2) AS averageOrderValue,
      ROUND(COUNT(*) * 1.0 / (SELECT COUNT(*) FROM users), 2) AS conversionRate,
      ROUND((SELECT AVG(price) FROM prompts WHERE price > 0), 2) AS averagePrice
     FROM orders`) ?? {
			revenue: 0,
			orders: 0,
			averageOrderValue: 0,
			conversionRate: 0,
			averagePrice: 0
		},
		creatorRevenue: sql.all(db, `SELECT c.name AS creator,
      ROUND(SUM(oi.price * oi.quantity), 2) AS revenue,
      ROUND(SUM(oi.price * oi.quantity) * c.payout_rate, 2) AS payout,
      SUM(oi.quantity) AS units
     FROM order_items oi
     JOIN prompts p ON p.id = oi.prompt_id
     JOIN creators c ON c.id = p.creator_id
     GROUP BY c.id
     ORDER BY revenue DESC`),
		categoryRevenue: sql.all(db, `SELECT p.category,
      ROUND(SUM(oi.price * oi.quantity), 2) AS revenue,
      SUM(oi.quantity) AS units
     FROM order_items oi
     JOIN prompts p ON p.id = oi.prompt_id
     GROUP BY p.category
     ORDER BY revenue DESC`),
		dailySales: sql.all(db, `SELECT created_at AS day, ROUND(SUM(total), 2) AS revenue, COUNT(*) AS orders
     FROM orders
     GROUP BY created_at
     ORDER BY created_at`)
	};
}
var getCatalogFn_createServerFn_handler = createServerRpc({
	id: "970904723766c3e6160b593b922973b17f181b1461c9daddd6335b52a23cca52",
	name: "getCatalogFn",
	filename: "src/server/queries.ts"
}, (opts) => getCatalogFn.__executeServer(opts));
var getCatalogFn = createServerFn({ method: "GET" }).validator((data) => data).handler(getCatalogFn_createServerFn_handler, ({ data }) => getCatalog(data));
var getPromptFn_createServerFn_handler = createServerRpc({
	id: "4c6cdc043c643eb1f92d887131aaad7bf8338143a69cbdd293620bff57cd59b8",
	name: "getPromptFn",
	filename: "src/server/queries.ts"
}, (opts) => getPromptFn.__executeServer(opts));
var getPromptFn = createServerFn({ method: "GET" }).validator((id) => id).handler(getPromptFn_createServerFn_handler, ({ data }) => getPrompt(data));
var getCartFn_createServerFn_handler = createServerRpc({
	id: "e4747ba48447e7ebf23d6eac8a8143be4506d6a3ddfb950b49363f1956721565",
	name: "getCartFn",
	filename: "src/server/queries.ts"
}, (opts) => getCartFn.__executeServer(opts));
var getCartFn = createServerFn({ method: "GET" }).handler(getCartFn_createServerFn_handler, () => getCart());
var getAnalyticsFn_createServerFn_handler = createServerRpc({
	id: "530c7b85bf1ad97bb4718fddca855905dd492dd7c5c7584fbf40bf4c8e8df2ac",
	name: "getAnalyticsFn",
	filename: "src/server/queries.ts"
}, (opts) => getAnalyticsFn.__executeServer(opts));
var getAnalyticsFn = createServerFn({ method: "GET" }).handler(getAnalyticsFn_createServerFn_handler, () => getAnalytics());
var toggleFavoriteFn_createServerFn_handler = createServerRpc({
	id: "f0a1aebe69f10935be5109da1c271bc5370eba796ef5ddb340e3cea5f1d9584f",
	name: "toggleFavoriteFn",
	filename: "src/server/queries.ts"
}, (opts) => toggleFavoriteFn.__executeServer(opts));
var toggleFavoriteFn = createServerFn({ method: "POST" }).validator((id) => id).handler(toggleFavoriteFn_createServerFn_handler, ({ data }) => toggleFavorite(data));
var addToCartFn_createServerFn_handler = createServerRpc({
	id: "e226ee45a36b009fd9cba791e9a888cb7a9518a6365310cbad533d8523f8ffcc",
	name: "addToCartFn",
	filename: "src/server/queries.ts"
}, (opts) => addToCartFn.__executeServer(opts));
var addToCartFn = createServerFn({ method: "POST" }).validator((id) => id).handler(addToCartFn_createServerFn_handler, ({ data }) => addToCart(data));
var checkoutCartFn_createServerFn_handler = createServerRpc({
	id: "422f2f51120ef93b121e38cd1bf5861f3f31d5f19ecc04f138b85a398c40f710",
	name: "checkoutCartFn",
	filename: "src/server/queries.ts"
}, (opts) => checkoutCartFn.__executeServer(opts));
var checkoutCartFn = createServerFn({ method: "POST" }).handler(checkoutCartFn_createServerFn_handler, () => checkoutCart());
//#endregion
export { addToCartFn_createServerFn_handler, checkoutCartFn_createServerFn_handler, getAnalyticsFn_createServerFn_handler, getCartFn_createServerFn_handler, getCatalogFn_createServerFn_handler, getPromptFn_createServerFn_handler, toggleFavoriteFn_createServerFn_handler };
