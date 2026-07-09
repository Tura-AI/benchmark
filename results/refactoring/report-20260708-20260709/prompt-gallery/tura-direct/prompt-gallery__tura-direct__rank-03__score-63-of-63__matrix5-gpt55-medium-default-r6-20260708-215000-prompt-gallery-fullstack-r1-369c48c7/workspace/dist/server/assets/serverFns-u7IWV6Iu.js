import { n as TSS_SERVER_FUNCTION, t as createServerFn } from "../server.js";
import { z } from "zod";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
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
//#region src/lib/db.ts
var dbFile = path.join(process.cwd(), "db", "powerprompt.sqlite3");
function getDb(file = dbFile) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const db = new Database(file);
	db.pragma("journal_mode = WAL");
	migrate(db);
	seed(db);
	return db;
}
function migrate(db) {
	db.exec(`
    create table if not exists creators(id text primary key,name text not null,handle text not null);
    create table if not exists categories(id text primary key,name text not null);
    create table if not exists prompts(id text primary key,title text not null,creator_id text not null,category_id text not null,model text not null,price_cents integer not null,featured integer not null,created_at text not null,sales integer not null,views integer not null,rating real not null,ratio text not null,image text not null,a text not null,b text not null,summary text not null,foreign key(creator_id) references creators(id),foreign key(category_id) references categories(id));
    create table if not exists users(id text primary key,name text not null);
    create table if not exists favorites(user_id text not null,prompt_id text not null,primary key(user_id,prompt_id));
    create table if not exists cart_items(user_id text not null,prompt_id text not null,qty integer not null default 1,primary key(user_id,prompt_id));
    create table if not exists orders(id text primary key,user_id text not null,created_at text not null,subtotal_cents integer not null,fee_cents integer not null,total_cents integer not null);
    create table if not exists order_items(order_id text not null,prompt_id text not null,creator_id text not null,price_cents integer not null,qty integer not null);
  `);
}
function seed(db) {
	if (db.prepare("select count(*) as n from prompts").get().n) return;
	db.transaction(() => {
		for (const c of [
			[
				"c1",
				"Mira Vale",
				"@miravale"
			],
			[
				"c2",
				"Studio Tonal",
				"@studiotonal"
			],
			[
				"c3",
				"Niko Ash",
				"@nikoash"
			],
			[
				"c4",
				"Lumen Kit",
				"@lumenkit"
			]
		]) db.prepare("insert into creators values(?,?,?)").run(...c);
		for (const c of [
			["beauty", "Beauty"],
			["product", "Product"],
			["fashion", "Fashion"],
			["editorial", "Editorial"],
			["interior", "Interior"]
		]) db.prepare("insert into categories values(?,?)").run(...c);
		db.prepare("insert into users values(?,?)").run("u1", "Demo buyer");
		for (const p of [
			[
				"p1",
				"Porcelain Glow Campaign",
				"c1",
				"beauty",
				"GPT-4o",
				1900,
				1,
				"2026-06-30",
				84,
				920,
				4.9,
				"4/5",
				"https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=900&q=80",
				"#f1d6c9",
				"#c9fa46",
				"Beauty ad prompt system for controlled skin texture, soft product light, and clean cosmetic framing."
			],
			[
				"p2",
				"Chrome Lip Macro Set",
				"c2",
				"beauty",
				"Midjourney",
				900,
				1,
				"2026-07-01",
				61,
				810,
				4.8,
				"3/4",
				"https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=900&q=80",
				"#d9d5cc",
				"#b8b1a4",
				"Macro prompt pack for reflective lip gloss, chrome props, and high-retention cosmetic colors."
			],
			[
				"p3",
				"Flux Bottle Shadow Lab",
				"c3",
				"product",
				"Flux",
				2400,
				1,
				"2026-07-02",
				72,
				1004,
				4.9,
				"5/4",
				"https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=900&q=80",
				"#f5eee4",
				"#8f9b77",
				"Precise product-lighting prompt for bottles, shadow ladders, and premium launch scenes."
			],
			[
				"p4",
				"Claude Wardrobe Director",
				"c4",
				"fashion",
				"Claude",
				0,
				0,
				"2026-07-03",
				35,
				380,
				4.6,
				"2/3",
				"https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80",
				"#ded8ca",
				"#a9a091",
				"A structured styling prompt for outfits, lens notes, casting, and fabric movement."
			],
			[
				"p5",
				"Editorial Beige Motion",
				"c1",
				"editorial",
				"GPT-4o",
				1500,
				1,
				"2026-07-04",
				58,
				700,
				4.7,
				"1/1",
				"https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
				"#ede2d5",
				"#c7b9a1",
				"Prompt framework for restrained editorial compositions with motion and neutral palettes."
			],
			[
				"p6",
				"Midnight Mascara Film",
				"c2",
				"beauty",
				"Midjourney",
				2100,
				0,
				"2026-07-05",
				43,
				560,
				4.6,
				"4/3",
				"https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=900&q=80",
				"#231f20",
				"#d6c8b5",
				"Dark beauty prompt for mascara, rimmed studio light, and controlled black surfaces."
			],
			[
				"p7",
				"Flux Minimal Shelf",
				"c3",
				"interior",
				"Flux",
				1200,
				0,
				"2026-07-06",
				30,
				440,
				4.4,
				"5/6",
				"https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=80",
				"#e8e3d7",
				"#a7aa96",
				"Interior prompt set for soft daylight shelves, muted accessories, and product placement."
			],
			[
				"p8",
				"Claude Retouch QA",
				"c4",
				"product",
				"Claude",
				0,
				1,
				"2026-07-07",
				95,
				1100,
				4.9,
				"3/5",
				"https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=900&q=80",
				"#f2ede3",
				"#cfc3af",
				"Checklist prompt for evaluating beauty and product renders before publishing."
			],
			[
				"p9",
				"Popular Cream Texture",
				"c1",
				"beauty",
				"GPT-4o",
				700,
				0,
				"2026-06-22",
				122,
				1300,
				4.8,
				"1/1",
				"https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?auto=format&fit=crop&w=900&q=80",
				"#fbf4e9",
				"#d8d1be",
				"Reusable texture prompt for swatches, cream smears, and soft cosmetic still life."
			],
			[
				"p10",
				"Fashion Lookbook Grid",
				"c2",
				"fashion",
				"Midjourney",
				1800,
				0,
				"2026-06-24",
				77,
				860,
				4.5,
				"4/5",
				"https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80",
				"#e6dace",
				"#9c7f6b",
				"Lookbook prompt for consistent outfits, catalog rhythm, and page-ready crops."
			],
			[
				"p11",
				"Flux Glass Reflection",
				"c3",
				"product",
				"Flux",
				2600,
				1,
				"2026-06-26",
				68,
				910,
				4.7,
				"16/11",
				"https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=900&q=80",
				"#f0eee6",
				"#ccd7d0",
				"High-control glass reflection prompt for premium bottles and transparent materials."
			],
			[
				"p12",
				"Claude Art Direction Memo",
				"c4",
				"editorial",
				"Claude",
				1100,
				0,
				"2026-06-28",
				49,
				520,
				4.6,
				"2/3",
				"https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=900&q=80",
				"#d7c6b6",
				"#ece5da",
				"Creative brief prompt that turns messy direction into image-ready art direction notes."
			]
		]) db.prepare("insert into prompts values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(...p);
		for (const f of [
			["u1", "p1"],
			["u1", "p3"],
			["u1", "p8"]
		]) db.prepare("insert into favorites values(?,?)").run(...f);
		for (const ci of [[
			"u1",
			"p2",
			1
		], [
			"u1",
			"p11",
			1
		]]) db.prepare("insert into cart_items values(?,?,?)").run(...ci);
		for (const o of [
			[
				"o1",
				"u1",
				"2026-07-01",
				2800,
				140,
				2940
			],
			[
				"o2",
				"u1",
				"2026-07-02",
				3900,
				195,
				4095
			],
			[
				"o3",
				"u1",
				"2026-07-03",
				1500,
				75,
				1575
			],
			[
				"o4",
				"u1",
				"2026-07-05",
				4700,
				235,
				4935
			]
		]) db.prepare("insert into orders values(?,?,?,?,?,?)").run(...o);
		for (const i of [
			[
				"o1",
				"p1",
				"c1",
				1900,
				1
			],
			[
				"o1",
				"p2",
				"c2",
				900,
				1
			],
			[
				"o2",
				"p3",
				"c3",
				2400,
				1
			],
			[
				"o2",
				"p5",
				"c1",
				1500,
				1
			],
			[
				"o3",
				"p10",
				"c2",
				1500,
				1
			],
			[
				"o4",
				"p11",
				"c3",
				2600,
				1
			],
			[
				"o4",
				"p6",
				"c2",
				2100,
				1
			]
		]) db.prepare("insert into order_items values(?,?,?,?,?)").run(...i);
	})();
}
var userId = "u1";
function listPrompts(filters = {}, db = getDb()) {
	const where = ["1=1"];
	const args = { userId };
	if (filters.model && filters.model !== "all") {
		where.push("p.model=@model");
		args.model = filters.model;
	}
	if (filters.category && filters.category !== "all") {
		where.push("p.category_id=@category");
		args.category = filters.category;
	}
	if (filters.q) {
		where.push("(p.title like @q or p.summary like @q or p.model like @q)");
		args.q = `%${filters.q}%`;
	}
	if (filters.favorites) where.push("f.prompt_id is not null");
	if (filters.free) where.push("p.price_cents=0");
	const order = filters.sort === "newest" ? "p.created_at desc" : filters.sort === "popular" ? "p.sales desc, p.views desc" : "p.featured desc, rank_score desc";
	return db.prepare(`select p.*, c.name creator, cat.name category, f.prompt_id is not null favorite,
    (p.sales*4 + p.views*.08 + p.rating*18 + p.featured*35 - p.price_cents*.002) rank_score
    from prompts p join creators c on c.id=p.creator_id join categories cat on cat.id=p.category_id
    left join favorites f on f.prompt_id=p.id and f.user_id=@userId where ${where.join(" and ")} order by ${order}`).all(args);
}
function getPrompt(id, db = getDb()) {
	return db.prepare("select p.*, c.name creator, c.handle, cat.name category from prompts p join creators c on c.id=p.creator_id join categories cat on cat.id=p.category_id where p.id=?").get(id);
}
function getCategories(db = getDb()) {
	return db.prepare("select cat.*, count(p.id) count from categories cat left join prompts p on p.category_id=cat.id group by cat.id order by cat.name").all();
}
function getCounts(db = getDb()) {
	return db.prepare("select count(*) total, sum(featured) featured, sum(price_cents=0) free, (select count(*) from favorites where user_id=?) favorites, (select count(*) from cart_items where user_id=?) cart from prompts").get(userId, userId);
}
function toggleFavorite(promptId, db = getDb()) {
	const row = db.prepare("select 1 from favorites where user_id=? and prompt_id=?").get(userId, promptId);
	row ? db.prepare("delete from favorites where user_id=? and prompt_id=?").run(userId, promptId) : db.prepare("insert into favorites values(?,?)").run(userId, promptId);
	return { favorite: !row };
}
function addToCart(promptId, db = getDb()) {
	db.prepare("insert into cart_items(user_id,prompt_id,qty) values(?,?,1) on conflict(user_id,prompt_id) do update set qty=qty+1").run(userId, promptId);
	return cartSummary(db);
}
function cartSummary(db = getDb()) {
	const items = db.prepare("select p.id,p.title,p.price_cents,ci.qty,c.name creator from cart_items ci join prompts p on p.id=ci.prompt_id join creators c on c.id=p.creator_id where ci.user_id=? order by p.title").all(userId);
	const subtotal = items.reduce((s, i) => s + i.price_cents * i.qty, 0);
	const fee = Math.round(subtotal * .05);
	return {
		items,
		subtotal,
		fee,
		total: subtotal + fee
	};
}
function checkout(db = getDb()) {
	const cart = cartSummary(db);
	if (!cart.items.length) return {
		ok: false,
		orderId: null,
		...cart
	};
	const id = `o${Date.now()}`;
	db.transaction(() => {
		db.prepare("insert into orders values(?,?,?,?,?,?)").run(id, userId, (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), cart.subtotal, cart.fee, cart.total);
		for (const i of cart.items) {
			const p = db.prepare("select creator_id from prompts where id=?").get(i.id);
			db.prepare("insert into order_items values(?,?,?,?,?)").run(id, i.id, p.creator_id, i.price_cents, i.qty);
		}
		db.prepare("delete from cart_items where user_id=?").run(userId);
	})();
	return {
		ok: true,
		orderId: id,
		...cart
	};
}
function analytics(db = getDb()) {
	return {
		totals: db.prepare("select sum(total_cents) revenue, count(*) orders, round(avg(total_cents),0) aov from orders").get(),
		creators: db.prepare("select c.name, sum(oi.price_cents*oi.qty) revenue, count(*) sales from order_items oi join creators c on c.id=oi.creator_id group by c.id order by revenue desc").all(),
		categories: db.prepare("select cat.name, sum(oi.price_cents*oi.qty) revenue from order_items oi join prompts p on p.id=oi.prompt_id join categories cat on cat.id=p.category_id group by cat.id order by revenue desc").all(),
		trends: db.prepare("select created_at day, sum(total_cents) revenue, count(*) orders from orders group by created_at order by created_at").all(),
		conversion: db.prepare("select round((select count(*) from orders)*100.0 / nullif((select sum(views) from prompts),0),2) rate").get()
	};
}
//#endregion
//#region src/lib/serverFns.ts?tss-serverfn-split
var filters = z.object({
	model: z.string().optional(),
	category: z.string().optional(),
	q: z.string().optional(),
	favorites: z.boolean().optional(),
	free: z.boolean().optional(),
	sort: z.enum([
		"featured",
		"newest",
		"popular"
	]).optional()
});
var fetchCatalog_createServerFn_handler = createServerRpc({
	id: "db433206399f33453b44766f5811265017089f44041de4b4ed5c385013bf02cf",
	name: "fetchCatalog",
	filename: "src/lib/serverFns.ts"
}, (opts) => fetchCatalog.__executeServer(opts));
var fetchCatalog = createServerFn({ method: "GET" }).validator((d) => filters.parse(d ?? {})).handler(fetchCatalog_createServerFn_handler, ({ data }) => ({
	prompts: listPrompts(data),
	categories: getCategories(),
	counts: getCounts()
}));
var fetchPrompt_createServerFn_handler = createServerRpc({
	id: "8d635cdf9485189215db5439e1187cdb346a0b397d6d453b82a0f03d606f298e",
	name: "fetchPrompt",
	filename: "src/lib/serverFns.ts"
}, (opts) => fetchPrompt.__executeServer(opts));
var fetchPrompt = createServerFn({ method: "GET" }).validator((d) => z.object({ id: z.string() }).parse(d)).handler(fetchPrompt_createServerFn_handler, ({ data }) => getPrompt(data.id));
var favoritePrompt_createServerFn_handler = createServerRpc({
	id: "5a2d87eb281e31d37c13cad122fe2f39a4ef3bb8a2c3880969562d8445fee7e6",
	name: "favoritePrompt",
	filename: "src/lib/serverFns.ts"
}, (opts) => favoritePrompt.__executeServer(opts));
var favoritePrompt = createServerFn({ method: "POST" }).validator((d) => z.object({ id: z.string() }).parse(d)).handler(favoritePrompt_createServerFn_handler, ({ data }) => toggleFavorite(data.id));
var putCart_createServerFn_handler = createServerRpc({
	id: "95bff5597c6cfa313f73e17ab50d4e31ee5675e4f1c6539e717f2973881a1dc2",
	name: "putCart",
	filename: "src/lib/serverFns.ts"
}, (opts) => putCart.__executeServer(opts));
var putCart = createServerFn({ method: "POST" }).validator((d) => z.object({ id: z.string() }).parse(d)).handler(putCart_createServerFn_handler, ({ data }) => addToCart(data.id));
var fetchCart_createServerFn_handler = createServerRpc({
	id: "b356e22d1550870763847c2864f29cd9dc823799f8a53dab9b26c39f3cff88c7",
	name: "fetchCart",
	filename: "src/lib/serverFns.ts"
}, (opts) => fetchCart.__executeServer(opts));
var fetchCart = createServerFn({ method: "GET" }).handler(fetchCart_createServerFn_handler, () => cartSummary());
var runCheckout_createServerFn_handler = createServerRpc({
	id: "583b715969ae805cf6c3e4291daa22a02ef63abf79d238bbb1bd0432da91c83b",
	name: "runCheckout",
	filename: "src/lib/serverFns.ts"
}, (opts) => runCheckout.__executeServer(opts));
var runCheckout = createServerFn({ method: "POST" }).handler(runCheckout_createServerFn_handler, () => checkout());
var fetchAnalytics_createServerFn_handler = createServerRpc({
	id: "0e0637d6ed3c6d17510f2caadfe11df5c8decc1943f199e0aee565b45ce5ed57",
	name: "fetchAnalytics",
	filename: "src/lib/serverFns.ts"
}, (opts) => fetchAnalytics.__executeServer(opts));
var fetchAnalytics = createServerFn({ method: "GET" }).handler(fetchAnalytics_createServerFn_handler, () => analytics());
//#endregion
export { favoritePrompt_createServerFn_handler, fetchAnalytics_createServerFn_handler, fetchCart_createServerFn_handler, fetchCatalog_createServerFn_handler, fetchPrompt_createServerFn_handler, putCart_createServerFn_handler, runCheckout_createServerFn_handler };
