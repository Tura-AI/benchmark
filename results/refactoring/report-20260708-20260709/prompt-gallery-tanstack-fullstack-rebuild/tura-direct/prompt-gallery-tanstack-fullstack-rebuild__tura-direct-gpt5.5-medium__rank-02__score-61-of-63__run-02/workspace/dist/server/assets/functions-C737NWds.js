import { n as TSS_SERVER_FUNCTION, t as createServerFn } from "../server.js";
import { a as getCart, c as removeFromCart, d as creators, f as demoUserId, h as seedOrders, i as checkout, l as toggleFavorite, m as seedOrderItems, n as addToCart, o as getPrompt, p as prompts, r as analytics, s as listCatalog, t as CatalogInput, u as categories } from "./queries-DYUnDG0Q.js";
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
var dbPath = join(process.cwd(), "data", "powerprompt.sqlite3");
var shared;
function getDb(path = dbPath) {
	if (path === dbPath && shared) return shared;
	mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path);
	db.pragma("journal_mode = WAL");
	migrate(db);
	seed(db);
	if (path === dbPath) shared = db;
	return db;
}
function migrate(db) {
	db.exec(`
    create table if not exists users (id text primary key, name text not null);
    create table if not exists creators (id text primary key, name text not null, handle text not null, specialty text not null, avatar text not null);
    create table if not exists categories (id text primary key, name text not null, color text not null);
    create table if not exists prompts (
      id text primary key, title text not null, slug text not null unique, model text not null,
      category_id text not null references categories(id), creator_id text not null references creators(id),
      price_cents integer not null check(price_cents >= 0), featured integer not null check(featured in (0,1)),
      image text not null, ratio text not null, description text not null, tags text not null,
      sales integer not null default 0, views integer not null default 0, rating real not null default 0, created_at text not null
    );
    create table if not exists favorites (user_id text not null, prompt_id text not null, primary key(user_id, prompt_id));
    create table if not exists cart_items (user_id text not null, prompt_id text not null, quantity integer not null default 1, primary key(user_id, prompt_id));
    create table if not exists orders (id text primary key, user_id text not null, subtotal_cents integer not null, fee_cents integer not null, total_cents integer not null, status text not null, created_at text not null);
    create table if not exists order_items (order_id text not null, prompt_id text not null, price_cents integer not null);
  `);
}
function seed(db) {
	db.prepare("insert or ignore into users (id, name) values (?, ?)").run(demoUserId, "Demo buyer");
	const creatorStmt = db.prepare("insert or ignore into creators values (@id, @name, @handle, @specialty, @avatar)");
	creators.forEach((creator) => creatorStmt.run(creator));
	const catStmt = db.prepare("insert or ignore into categories values (@id, @name, @color)");
	categories.forEach((category) => catStmt.run(category));
	const promptStmt = db.prepare(`insert or ignore into prompts values (
    @id, @title, @slug, @model, @categoryId, @creatorId, @priceCents, @featured, @image, @ratio, @description, @tags, @sales, @views, @rating, @createdAt
  )`);
	prompts.forEach((prompt) => promptStmt.run(prompt));
	db.prepare("insert or ignore into favorites values (?, ?)").run(demoUserId, "p-001");
	db.prepare("insert or ignore into favorites values (?, ?)").run(demoUserId, "p-007");
	db.prepare("insert or ignore into cart_items values (?, ?, ?)").run(demoUserId, "p-002", 1);
	db.prepare("insert or ignore into cart_items values (?, ?, ?)").run(demoUserId, "p-004", 1);
	const orderStmt = db.prepare("insert or ignore into orders values (?, ?, ?, ?, ?, ?, ?)");
	seedOrders.forEach((order) => orderStmt.run(...order));
	const itemStmt = db.prepare("insert or ignore into order_items values (?, ?, ?)");
	seedOrderItems.forEach((item) => itemStmt.run(...item));
}
//#endregion
//#region src/server/functions.ts?tss-serverfn-split
var getCatalog_createServerFn_handler = createServerRpc({
	id: "139f47dabd199ca193485998f05c0927e2db6a30f494389b8c480d8011f52eef",
	name: "getCatalog",
	filename: "src/server/functions.ts"
}, (opts) => getCatalog.__executeServer(opts));
var getCatalog = createServerFn({ method: "GET" }).validator((input) => CatalogInput.partial().parse(input ?? {})).handler(getCatalog_createServerFn_handler, ({ data }) => listCatalog(getDb(), data));
var getPromptDetail_createServerFn_handler = createServerRpc({
	id: "3eb9f0aa77bdb2987d0efea63552755d8d7acbbdf291915772f10c0fce7b138f",
	name: "getPromptDetail",
	filename: "src/server/functions.ts"
}, (opts) => getPromptDetail.__executeServer(opts));
var getPromptDetail = createServerFn({ method: "GET" }).validator((input) => String(input ?? "")).handler(getPromptDetail_createServerFn_handler, ({ data }) => getPrompt(getDb(), data));
var toggleFavoriteAction_createServerFn_handler = createServerRpc({
	id: "95f42230fe6a291a6eb1077dc75ef082efebb42d5e39da48c3a0f438126981ef",
	name: "toggleFavoriteAction",
	filename: "src/server/functions.ts"
}, (opts) => toggleFavoriteAction.__executeServer(opts));
var toggleFavoriteAction = createServerFn({ method: "POST" }).validator((input) => String(input ?? "")).handler(toggleFavoriteAction_createServerFn_handler, ({ data }) => toggleFavorite(getDb(), data));
var addCartAction_createServerFn_handler = createServerRpc({
	id: "13f0cf0f41384ab8786cfde842fae2aba39f43e639fc809f5adc617c86375fc8",
	name: "addCartAction",
	filename: "src/server/functions.ts"
}, (opts) => addCartAction.__executeServer(opts));
var addCartAction = createServerFn({ method: "POST" }).validator((input) => String(input ?? "")).handler(addCartAction_createServerFn_handler, ({ data }) => addToCart(getDb(), data));
var removeCartAction_createServerFn_handler = createServerRpc({
	id: "4e2d6bd5e56c16dc12def0231eb590d138ac36c44c47a93fca559c1a848b2355",
	name: "removeCartAction",
	filename: "src/server/functions.ts"
}, (opts) => removeCartAction.__executeServer(opts));
var removeCartAction = createServerFn({ method: "POST" }).validator((input) => String(input ?? "")).handler(removeCartAction_createServerFn_handler, ({ data }) => removeFromCart(getDb(), data));
var getCartState_createServerFn_handler = createServerRpc({
	id: "791ad9f1009ae519a1b84b813bbf1227971ef2656a1154e9da2d4c18d7f77ccd",
	name: "getCartState",
	filename: "src/server/functions.ts"
}, (opts) => getCartState.__executeServer(opts));
var getCartState = createServerFn({ method: "GET" }).handler(getCartState_createServerFn_handler, () => getCart(getDb()));
var checkoutAction_createServerFn_handler = createServerRpc({
	id: "88a0aa3b3a0679fab1b61164564096ddaa7885cf0effd9ed2fee5d3a6b563426",
	name: "checkoutAction",
	filename: "src/server/functions.ts"
}, (opts) => checkoutAction.__executeServer(opts));
var checkoutAction = createServerFn({ method: "POST" }).handler(checkoutAction_createServerFn_handler, () => checkout(getDb()));
var getAnalytics_createServerFn_handler = createServerRpc({
	id: "b44ab6b9bf49d673887034f6193581aae0e7cfeaa8c5da9a11fb677b9ac3b058",
	name: "getAnalytics",
	filename: "src/server/functions.ts"
}, (opts) => getAnalytics.__executeServer(opts));
var getAnalytics = createServerFn({ method: "GET" }).handler(getAnalytics_createServerFn_handler, () => analytics(getDb()));
//#endregion
export { addCartAction_createServerFn_handler, checkoutAction_createServerFn_handler, getAnalytics_createServerFn_handler, getCartState_createServerFn_handler, getCatalog_createServerFn_handler, getPromptDetail_createServerFn_handler, removeCartAction_createServerFn_handler, toggleFavoriteAction_createServerFn_handler };
