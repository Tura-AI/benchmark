import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type PowerPromptDb = Database.Database

const creators = [
  [1, 'Atlas Studio', 'atlas@powerprompt.local'],
  [2, 'Field & Co.', 'field@powerprompt.local'],
  [3, 'Lumen', 'lumen@powerprompt.local'],
  [4, 'Sakuga', 'sakuga@powerprompt.local'],
]

const prompts = [
  [207,'cinematic-still-35mm','Cinematic Still, 35mm','Midjourney','Image',900,4700,18600,5,1,'3 / 4','Film-grade stills with real lens language, natural grain, and restrained light.','/media/prompts/cinematic/generate-media-replicate_z_image_turbo-1.png',1,'2026-06-28'],
  [233,'ink-wash-warrior','Ink Wash Warrior','Midjourney','Image',1200,2100,9800,4.9,4,'2 / 3','Sumi-e meets splash ink with controlled negative space and decisive gesture.','/media/prompts/ink/generate-media-replicate_z_image_turbo-1.png',1,'2026-06-25'],
  [174,'editorial-photo-grade','Editorial Photo Grade','Flux','Photography',1100,1300,7200,4.9,3,'3 / 4','Warm skin, deep shadow, and a quiet print finish without garish presets.','/media/prompts/editorial/generate-media-replicate_z_image_turbo-1.png',1,'2026-06-30'],
  [301,'magazine-cover-maker','Magazine Cover Maker','GPT-4o','Design',1400,3300,14100,4.8,2,'4 / 5','A disciplined editorial system for cover concepts, hierarchy, and art direction.','/media/prompts/magazine/generate-media-replicate_z_image_turbo-1.png',1,'2026-07-01'],
  [118,'studio-portrait-soft-light','Studio Portrait, Soft Light','Flux','Photography',1000,1800,8900,4.9,3,'4 / 5','Clean beauty light with believable falloff that looks shot, not rendered.','/media/prompts/portrait/generate-media-replicate_z_image_turbo-1.png',1,'2026-06-22'],
  [198,'logo-sketch-monoline','Logo Sketch, Mono-line','Midjourney','Design',1300,980,5100,4.8,1,'1 / 1','Single-weight line marks with practical negative-space directions.','/media/prompts/logo/generate-media-replicate_z_image_turbo-1.png',0,'2026-07-05'],
  [142,'cold-email-closer','The Cold-Email Closer','GPT-4o','Marketing',1200,2300,10900,4.9,2,'4 / 3','A compact outreach structure with specific subject-line variants.','/media/prompts/cinematic/generate-media-replicate_z_image_turbo-1.png',1,'2026-06-20'],
  [160,'senior-code-reviewer','Senior Code Reviewer','Claude','Code',1800,1100,6700,4.8,1,'1 / 1','Reviews a diff like a staff engineer: risk, fixes, and the reasoning behind both.','/media/prompts/logo/generate-media-replicate_z_image_turbo-1.png',1,'2026-07-03'],
  [255,'neon-street-night','Neon Street, Night','Flux','Photography',800,2600,13100,4.7,3,'3 / 4','Rain-slick night photography with real reflections and natural film grain.','/media/prompts/neon/generate-media-replicate_z_image_turbo-1.png',0,'2026-06-18'],
  [189,'brand-voice-bottled','Brand Voice, Bottled','Claude','Marketing',2400,860,4800,4.9,2,'4 / 3','Builds a reusable writing guide from a small set of representative samples.','/media/prompts/editorial/generate-media-replicate_z_image_turbo-1.png',1,'2026-07-07'],
  [211,'anime-key-visual','Anime Key Visual','Midjourney','Image',1500,3900,17700,5,4,'2 / 3','Poster-grade key art with a strong subject, atmosphere, and print-ready detail.','/media/prompts/anime/generate-media-replicate_z_image_turbo-1.png',1,'2026-06-16'],
  [31,'socratic-tutor','The Socratic Tutor','GPT-4o','Research',0,9200,32600,4.7,2,'5 / 4','Leads learners toward an answer using questions at the right difficulty.','/media/prompts/watercolor/generate-media-replicate_z_image_turbo-1.png',1,'2026-06-12'],
  [276,'product-shot-white-bg','Product Shot, White BG','Flux','Photography',900,1500,8100,4.8,3,'1 / 1','Clean e-commerce imagery with precise highlights and soft contact shadows.','/media/prompts/product/generate-media-replicate_z_image_turbo-1.png',0,'2026-07-08'],
  [212,'worldbuilders-bible','The Worldbuilder’s Bible','GPT-4o','Writing',2900,720,4600,5,2,'4 / 5','Builds coherent geography, factions, and history while holding continuity.','/media/prompts/watercolor/generate-media-replicate_z_image_turbo-1.png',1,'2026-07-06'],
  [248,'vintage-film-poster','Vintage Film Poster','Midjourney','Design',1300,2200,9900,4.9,1,'3 / 4','Period-aware grain, halftone, and composition for archival one-sheet results.','/media/prompts/poster/generate-media-replicate_z_image_turbo-1.png',1,'2026-06-14'],
  [156,'bug-to-test-generator','Bug-to-Test Generator','GPT-4o','Code',1500,1900,9200,4.8,1,'4 / 3','Turns a report into a reproduction, fix direction, and edge-case checklist.','/media/prompts/car/generate-media-replicate_z_image_turbo-1.png',0,'2026-07-09'],
  [267,'dreamy-bokeh-portrait','Dreamy Bokeh Portrait','Flux','Photography',1000,1700,8500,4.8,3,'4 / 5','Warm portrait light, precise eyes, and a natural shallow depth of field.','/media/prompts/portrait/generate-media-replicate_z_image_turbo-1.png',0,'2026-06-29'],
  [101,'meeting-to-memo','Meeting → Memo','Claude','Productivity',600,5100,20200,4.7,2,'4 / 3','Converts a transcript into decisions, owners, dates, and immediate next steps.','/media/prompts/magazine/generate-media-replicate_z_image_turbo-1.png',1,'2026-06-10'],
  [290,'concept-car-studio','Concept Car, Studio','Midjourney','Image',1200,1400,7400,4.8,1,'3 / 2','Automotive concepts with believable studio reflections and a true sense of scale.','/media/prompts/car/generate-media-replicate_z_image_turbo-1.png',0,'2026-07-04'],
  [77,'plot-doctor','The Plot Doctor','Claude','Writing',1600,1400,7900,4.9,4,'1 / 1','Diagnoses stalled stories through stakes, pacing, and the avoided scene.','/media/prompts/poster/generate-media-replicate_z_image_turbo-1.png',1,'2026-06-24'],
  [221,'watercolor-cityscape','Watercolor Cityscape','Flux','Image',900,2000,9600,4.9,3,'3 / 4','Loose luminous washes, confident linework, soft skies, and active streets.','/media/prompts/watercolor/generate-media-replicate_z_image_turbo-1.png',0,'2026-06-26'],
  [63,'inbox-zero-strategist','Inbox Zero Strategist','Claude','Productivity',800,3400,15200,4.6,2,'4 / 3','Triages, drafts, and schedules an inbox around what moves the week.','/media/prompts/editorial/generate-media-replicate_z_image_turbo-1.png',0,'2026-06-21']
]

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS creators (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS prompts (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, model TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents >= 0), sold INTEGER NOT NULL, views INTEGER NOT NULL, rating REAL NOT NULL, creator_id INTEGER NOT NULL REFERENCES creators(id), aspect TEXT NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL, featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS favorites (user_id INTEGER NOT NULL REFERENCES users(id), prompt_id INTEGER NOT NULL REFERENCES prompts(id), PRIMARY KEY(user_id,prompt_id));
CREATE TABLE IF NOT EXISTS cart_items (user_id INTEGER NOT NULL REFERENCES users(id), prompt_id INTEGER NOT NULL REFERENCES prompts(id), quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(user_id,prompt_id));
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, fee_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_items (order_id INTEGER NOT NULL REFERENCES orders(id), prompt_id INTEGER NOT NULL REFERENCES prompts(id), creator_id INTEGER NOT NULL REFERENCES creators(id), quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, PRIMARY KEY(order_id,prompt_id));
`

export function createDatabase(filename = ':memory:'): PowerPromptDb {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.exec(schema)
  seedDatabase(db)
  return db
}

export function seedDatabase(db: PowerPromptDb) {
  const seed = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO users VALUES (1, ?, ?)').run('guest@powerprompt.local', 'Guest curator')
    const addCreator = db.prepare('INSERT OR IGNORE INTO creators VALUES (?, ?, ?)')
    creators.forEach((row) => addCreator.run(...row))
    const categoryNames = [...new Set(prompts.map((row) => row[4] as string))]
    const addCategory = db.prepare('INSERT OR IGNORE INTO categories(id,name) VALUES (?,?)')
    categoryNames.forEach((name, index) => addCategory.run(index + 1, name))
    const addPrompt = db.prepare('INSERT OR IGNORE INTO prompts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    prompts.forEach((row) => addPrompt.run(...row))
    db.prepare('INSERT OR IGNORE INTO favorites VALUES (1,207)').run()
    db.prepare('INSERT OR IGNORE INTO favorites VALUES (1,31)').run()
    const addOrder = db.prepare('INSERT OR IGNORE INTO orders VALUES (?,?,?,?,?,?,?)')
    addOrder.run(1,1,'paid',2600,208,2808,'2026-07-04')
    addOrder.run(2,1,'paid',2400,192,2592,'2026-07-06')
    addOrder.run(3,1,'paid',3300,264,3564,'2026-07-08')
    const addItem = db.prepare('INSERT OR IGNORE INTO order_items VALUES (?,?,?,?,?)')
    addItem.run(1,207,1,1,900); addItem.run(1,160,1,1,1700)
    addItem.run(2,189,2,1,2400); addItem.run(3,301,2,1,1400); addItem.run(3,101,2,1,600); addItem.run(3,118,3,1,1000); addItem.run(3,31,2,1,0)
  })
  seed()
}

let singleton: PowerPromptDb | undefined
export function getDatabase() {
  if (!singleton) singleton = createDatabase(join(process.cwd(), 'data', 'powerprompt.sqlite'))
  return singleton
}
