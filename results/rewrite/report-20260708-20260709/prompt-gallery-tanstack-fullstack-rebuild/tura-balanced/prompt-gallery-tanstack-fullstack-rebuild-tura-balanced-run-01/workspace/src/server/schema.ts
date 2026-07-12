export const schemaSql = `
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
`
