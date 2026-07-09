import { a as orderItems, c as userId, i as favorites, n as categories, o as orderRows, r as creators, s as prompts, t as cart } from "./seed-FYamb1wu.js";
import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
//#region src/server/schema.ts
var schemaSql = `
CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  payout_rate REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  model TEXT NOT NULL CHECK (model IN ('GPT-4o','Claude','Midjourney','Flux')),
  category TEXT NOT NULL REFERENCES categories(name),
  price REAL NOT NULL CHECK (price >= 0),
  sold INTEGER NOT NULL,
  rating REAL NOT NULL,
  creator_id TEXT NOT NULL REFERENCES creators(id),
  aspect TEXT NOT NULL,
  featured INTEGER NOT NULL CHECK (featured IN (0,1)),
  created_at TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  PRIMARY KEY (user_id, prompt_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  user_id TEXT NOT NULL REFERENCES users(id),
  prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (user_id, prompt_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  subtotal REAL NOT NULL,
  fee REAL NOT NULL,
  total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (order_id, prompt_id)
);
`;
//#endregion
//#region src/server/db.ts
var dataDir = path.resolve(process.cwd(), "data");
var dbPath = path.join(dataDir, "powerprompt.sqlite3");
var dbPromise;
function run(db, sql, params = []) {
	db.run(sql, params);
}
function first(db, sql, params = []) {
	const rows = db.exec(sql, params);
	if (!rows[0] || rows[0].values.length === 0) return null;
	return Object.fromEntries(rows[0].columns.map((column, index) => [column, rows[0].values[0][index]]));
}
function all(db, sql, params = []) {
	const rows = db.exec(sql, params);
	if (!rows[0]) return [];
	return rows[0].values.map((row) => Object.fromEntries(rows[0].columns.map((column, index) => [column, row[index]])));
}
function persist(db) {
	fs.mkdirSync(dataDir, { recursive: true });
	fs.writeFileSync(dbPath, Buffer.from(db.export()));
}
async function openDatabase() {
	const SQL = await initSqlJs();
	const existing = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : void 0;
	const db = existing ? new SQL.Database(existing) : new SQL.Database();
	db.run(schemaSql);
	if ((first(db, "SELECT COUNT(*) AS count FROM prompts")?.count ?? 0) === 0) {
		seed(db);
		persist(db);
	}
	return db;
}
function getDb() {
	dbPromise ??= openDatabase();
	return dbPromise;
}
function resetDbForTests() {
	dbPromise = void 0;
	if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
}
function seed(db) {
	run(db, "INSERT INTO users (id, email) VALUES (?, ?)", [userId, "demo@powerprompt.local"]);
	for (const creator of creators) run(db, "INSERT INTO creators (id, name, handle, payout_rate) VALUES (?, ?, ?, ?)", [
		creator.id,
		creator.name,
		creator.handle,
		creator.payoutRate
	]);
	for (const name of categories) run(db, "INSERT INTO categories (id, name) VALUES (?, ?)", [name.toLowerCase(), name]);
	for (const prompt of prompts) run(db, `INSERT INTO prompts (id, title, model, category, price, sold, rating, creator_id, aspect, featured, created_at, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
		prompt.id,
		prompt.title,
		prompt.model,
		prompt.category,
		prompt.price,
		prompt.sold,
		prompt.rating,
		prompt.creatorId,
		prompt.aspect,
		prompt.featured,
		prompt.createdAt,
		prompt.desc
	]);
	for (const promptId of favorites) run(db, "INSERT INTO favorites (user_id, prompt_id) VALUES (?, ?)", [userId, promptId]);
	for (const promptId of cart) run(db, "INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (?, ?, 1)", [userId, promptId]);
	for (const order of orderRows) run(db, "INSERT INTO orders (id, user_id, created_at, subtotal, fee, total) VALUES (?, ?, ?, ?, ?, ?)", [
		order.id,
		order.userId,
		order.createdAt,
		order.subtotal,
		order.fee,
		order.total
	]);
	for (const item of orderItems) run(db, "INSERT INTO order_items (order_id, prompt_id, quantity, price) VALUES (?, ?, ?, ?)", [
		item.orderId,
		item.promptId,
		item.quantity,
		item.price
	]);
}
var sql = {
	all,
	first,
	run,
	persist,
	userId
};
//#endregion
export { getDb, resetDbForTests, sql };
