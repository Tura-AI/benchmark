PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  title TEXT NOT NULL,
  model TEXT NOT NULL CHECK(model IN ('GPT-4o','Claude','Midjourney','Flux')),
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  sold INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL CHECK(rating BETWEEN 0 AND 5),
  image TEXT NOT NULL,
  aspect TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  prompt_id TEXT NOT NULL REFERENCES prompts(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, prompt_id)
);
CREATE TABLE IF NOT EXISTS cart_items (
  user_id TEXT NOT NULL REFERENCES users(id),
  prompt_id TEXT NOT NULL REFERENCES prompts(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, prompt_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('completed','refunded')),
  subtotal_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  prompt_id TEXT NOT NULL REFERENCES prompts(id),
  creator_id TEXT NOT NULL REFERENCES creators(id),
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  PRIMARY KEY(order_id, prompt_id)
);
CREATE TABLE IF NOT EXISTS daily_metrics (
  day TEXT PRIMARY KEY,
  visits INTEGER NOT NULL,
  checkouts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS prompts_filter_idx ON prompts(model, category_id, featured, created_at);
CREATE INDEX IF NOT EXISTS orders_date_idx ON orders(created_at, status);
