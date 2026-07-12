PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS creators (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  joined_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES creators(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  title TEXT NOT NULL,
  model TEXT NOT NULL CHECK(model IN ('GPT-4o','Claude','Midjourney','Flux')),
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  sold INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL CHECK(rating BETWEEN 0 AND 5),
  aspect_ratio TEXT NOT NULL,
  description TEXT NOT NULL,
  image TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id),
  prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, prompt_id)
);
CREATE TABLE IF NOT EXISTS cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id),
  prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, prompt_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('paid','refunded')),
  subtotal_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  creator_id INTEGER NOT NULL REFERENCES creators(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  PRIMARY KEY(order_id, prompt_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  converted INTEGER NOT NULL CHECK(converted IN (0,1)),
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompts_model ON prompts(model);
CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
