import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dbPath = process.env.POWERPROMPT_DB ?? join(process.cwd(), 'data', 'powerprompt.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL UNIQUE,
      bio TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      category_id TEXT NOT NULL REFERENCES categories(id),
      title TEXT NOT NULL,
      model TEXT NOT NULL CHECK(model IN ('GPT-4o','Claude','Midjourney','Flux')),
      price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      rating REAL NOT NULL,
      sales INTEGER NOT NULL,
      views INTEGER NOT NULL,
      image TEXT NOT NULL,
      ratio TEXT NOT NULL,
      featured INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt_id TEXT NOT NULL REFERENCES prompts(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt_id TEXT NOT NULL REFERENCES prompts(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      subtotal_cents INTEGER NOT NULL,
      fee_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      order_id TEXT NOT NULL REFERENCES orders(id),
      prompt_id TEXT NOT NULL REFERENCES prompts(id),
      price_cents INTEGER NOT NULL,
      PRIMARY KEY (order_id, prompt_id)
    );
  `);
}

const creators = [
  ['cr-1', 'Mara Voss', '@mara', 'Fashion retail prompt systems and editorial commerce.'],
  ['cr-2', 'Jun Park', '@jun', 'Cinematic image workflows for launch teams.'],
  ['cr-3', 'Nadia Vale', '@nadia', 'Conversion copy and agentic storefront prompts.'],
  ['cr-4', 'Iris Kato', '@iris', 'Beauty, makeup, product and creator prompt packs.']
];

const categories = [
  ['beauty', 'Beauty', '#c9fa46'],
  ['commerce', 'Commerce', '#f7d774'],
  ['cinema', 'Cinema', '#d7c5ff'],
  ['social', 'Social', '#ffb6a5'],
  ['systems', 'Systems', '#a8d8ff']
];

const prompts = [
  ['gloss-editorial', 'cr-4', 'beauty', 'Gloss Editorial Makeup Sheet', 'GPT-4o', 1900, 4.9, 842, 6800, '/media/prompts/generate-media-replicate_z_image_turbo-1.png', '4 / 5', 1, 'Generate precise beauty campaign prompts with product, finish, shade and lighting controls.', '2026-06-28'],
  ['skin-tone-matrix', 'cr-4', 'beauty', 'Inclusive Skin Tone Matrix', 'Claude', 2400, 4.8, 613, 5100, '/media/prompts/generate-media-replicate_z_image_turbo-1.png', '1 / 1', 1, 'Audit and rewrite makeup prompts across undertone, age, texture and lighting conditions.', '2026-06-24'],
  ['launch-hero-kit', 'cr-2', 'cinema', 'Launch Hero Film Kit', 'Midjourney', 3200, 4.9, 721, 9300, '/media/prompts/generate-media-replicate_z_image_turbo-1-1.png', '3 / 4', 1, 'Cinematic visual prompt kit for product launch hero imagery and motion boards.', '2026-06-20'],
  ['flux-beauty-stills', 'cr-2', 'beauty', 'Flux Beauty Still Builder', 'Flux', 2800, 4.7, 488, 4400, '/media/prompts/generate-media-replicate_z_image_turbo-1-3.png', '5 / 7', 0, 'Flux-ready still life prompts for compact cosmetics, glass, powder and skin texture.', '2026-06-18'],
  ['cart-abandonment-agent', 'cr-3', 'commerce', 'Cart Abandonment Agent', 'GPT-4o', 3900, 4.8, 534, 7800, '/media/prompts/generate-media-replicate_z_image_turbo-1-2.png', '4 / 3', 1, 'Recover cart sessions with brand-safe reminders, offers and checkout context.', '2026-06-15'],
  ['ugc-shot-list', 'cr-1', 'social', 'Creator UGC Shot List', 'Claude', 1700, 4.6, 304, 2600, '/media/prompts/generate-media-replicate_z_image_turbo-1-2.png', '9 / 12', 0, 'Prompt a week of creator briefs with hooks, angles, claims and compliance notes.', '2026-06-11'],
  ['ad-variant-lab', 'cr-3', 'commerce', 'Ad Variant Lab', 'GPT-4o', 2600, 4.7, 642, 6100, '/media/prompts/generate-media-replicate_z_image_turbo-1-2.png', '1 / 1', 1, 'Generate and rank ad concepts by persona, objection, promise and proof.', '2026-06-08'],
  ['portrait-lighting-map', 'cr-2', 'cinema', 'Portrait Lighting Map', 'Midjourney', 0, 4.5, 1090, 12500, '/media/prompts/generate-media-replicate_z_image_turbo-1-1.png', '2 / 3', 0, 'Free lighting recipes for clean portrait and campaign image generation.', '2026-06-05'],
  ['shade-name-system', 'cr-4', 'beauty', 'Shade Name System', 'Claude', 900, 4.4, 259, 1900, '/media/prompts/generate-media-replicate_z_image_turbo-1.png', '4 / 5', 0, 'Create naming territories for color cosmetics without repeated generic language.', '2026-06-01'],
  ['prompt-api-spec', 'cr-1', 'systems', 'Prompt API Spec Writer', 'GPT-4o', 2200, 4.6, 331, 4100, '/media/prompts/generate-media-replicate_z_image_turbo-1-2.png', '5 / 4', 0, 'Turn marketplace prompt packs into structured JSON contracts and test fixtures.', '2026-05-29'],
  ['seasonal-drop-board', 'cr-1', 'commerce', 'Seasonal Drop Board', 'Flux', 2100, 4.5, 288, 3000, '/media/prompts/generate-media-replicate_z_image_turbo-1-2.png', '3 / 4', 0, 'Plan a product drop with images, titles, bundles and channel-specific variants.', '2026-05-25'],
  ['makeup-macro-free', 'cr-4', 'beauty', 'Makeup Macro Free Pack', 'Midjourney', 0, 4.3, 1180, 13800, '/media/prompts/generate-media-replicate_z_image_turbo-1-3.png', '16 / 11', 1, 'Starter macro prompts for lipstick, powder, skin, gloss and glass highlights.', '2026-05-21']
];

export function seed() {
  migrate();
  const count = db.prepare('SELECT COUNT(*) AS n FROM prompts').get() as { n: number };
  if (count.n > 0) return;
  const insertCreator = db.prepare('INSERT INTO creators VALUES (?, ?, ?, ?)');
  const insertCategory = db.prepare('INSERT INTO categories VALUES (?, ?, ?)');
  const insertPrompt = db.prepare(`INSERT INTO prompts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertUser = db.prepare('INSERT INTO users VALUES (?, ?)');
  const insertFavorite = db.prepare('INSERT INTO favorites VALUES (?, ?, ?)');
  const insertCart = db.prepare('INSERT INTO cart_items VALUES (?, ?, ?)');
  const insertOrder = db.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)');
  const insertOrderItem = db.prepare('INSERT INTO order_items VALUES (?, ?, ?)');
  const tx = db.transaction(() => {
    creators.forEach((row) => insertCreator.run(...row));
    categories.forEach((row) => insertCategory.run(...row));
    prompts.forEach((row) => insertPrompt.run(...row));
    insertUser.run('user-demo', 'Demo Buyer');
    insertFavorite.run('user-demo', 'gloss-editorial', '2026-07-01');
    insertFavorite.run('user-demo', 'portrait-lighting-map', '2026-07-02');
    insertCart.run('user-demo', 'cart-abandonment-agent', '2026-07-03');
    insertCart.run('user-demo', 'makeup-macro-free', '2026-07-03');
    const orders = [
      ['ord-1', 'user-demo', 5100, 255, 5355, '2026-06-28'],
      ['ord-2', 'user-demo', 4500, 225, 4725, '2026-06-29'],
      ['ord-3', 'user-demo', 3900, 195, 4095, '2026-07-01']
    ];
    orders.forEach((row) => insertOrder.run(...row));
    [['ord-1','gloss-editorial',1900],['ord-1','launch-hero-kit',3200],['ord-2','skin-tone-matrix',2400],['ord-2','seasonal-drop-board',2100],['ord-3','cart-abandonment-agent',3900]].forEach((row) => insertOrderItem.run(...row));
  });
  tx();
}

seed();

export const demoUserId = 'user-demo';
