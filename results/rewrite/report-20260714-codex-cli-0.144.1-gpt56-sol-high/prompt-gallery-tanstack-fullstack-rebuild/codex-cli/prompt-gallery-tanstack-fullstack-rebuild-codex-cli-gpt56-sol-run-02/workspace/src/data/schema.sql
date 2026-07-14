PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS creators (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, handle TEXT UNIQUE NOT NULL, initials TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, slug TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, model TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id), creator_id INTEGER NOT NULL REFERENCES creators(id),
  price REAL NOT NULL CHECK(price >= 0), sold_count INTEGER NOT NULL DEFAULT 0, rating REAL NOT NULL,
  aspect_ratio TEXT NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id), prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, prompt_id)
);
CREATE TABLE IF NOT EXISTS cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id), prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0), PRIMARY KEY(user_id, prompt_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, reference TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  quantity INTEGER NOT NULL, unit_price REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_views (
  id INTEGER PRIMARY KEY, prompt_id INTEGER NOT NULL REFERENCES prompts(id), viewed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompts_model ON prompts(model);
CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders(status, created_at);
