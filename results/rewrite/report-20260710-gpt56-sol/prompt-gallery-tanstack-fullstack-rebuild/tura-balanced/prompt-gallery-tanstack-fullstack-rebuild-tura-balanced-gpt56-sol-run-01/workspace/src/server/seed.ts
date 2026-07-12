import type Database from 'better-sqlite3'

const creators = [
  [1, 'Atlas Studio', '@atlas', '2024-02-10'],
  [2, 'Field & Co.', '@fieldco', '2024-04-18'],
  [3, 'Lumen Works', '@lumen', '2024-06-03'],
  [4, 'Ops Guild', '@opsguild', '2024-07-21'],
] as const

const categories = ['Image', 'Photography', 'Design', 'Writing', 'Code', 'Marketing', 'Productivity', 'Research']

const prompts = [
  [207,1,1,'Cinematic Still, 35mm','Midjourney',900,4700,5,'3/4','Film-grade stills with real lens language, focal length, grain, and lighting that reads as cinema.',1],
  [233,1,1,'Ink Wash Warrior','Midjourney',1200,2100,4.9,'2/3','Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space.',1],
  [174,3,2,'Editorial Photo Grade','Flux',1100,1300,4.9,'3/4','Magazine-style color grading with warm skin, deep shadow, and a quiet print look.',1],
  [301,2,3,'Magazine Cover Maker','GPT-4o',1400,3300,4.8,'4/5','Drop in a photo and get a complete editorial cover system with disciplined hierarchy.',1],
  [118,3,2,'Studio Portrait, Soft Light','Flux',1000,1800,4.9,'4/5','Clean beauty light with a believable falloff. Looks shot, not rendered.',0],
  [198,1,3,'Logo Sketch, Mono-line','Midjourney',1300,980,4.8,'1/1','Single-weight line marks with real negative-space thinking and vector-ready directions.',0],
  [142,2,6,'The Cold-Email Closer','GPT-4o',1200,2300,4.9,'4/3','Cold emails built on a tested four-line structure with subject-line variants.',1],
  [160,4,5,'Senior Code Reviewer','Claude',1800,1100,4.8,'1/1','Reviews a diff like a staff engineer, catches risk, suggests fixes, and explains why.',1],
  [255,3,2,'Neon Street, Night','Flux',800,2600,4.7,'3/4','Rain-slick streets with convincing reflections, practical light, and film grain.',0],
  [189,2,6,'Brand Voice, Bottled','Claude',2400,860,4.9,'4/3','Turns three samples into a reusable voice guide that writes in your exact tone.',1],
  [211,1,1,'Anime Key Visual','Midjourney',1500,3900,5,'2/3','Poster-grade key art with depth, deliberate light, and a clear focal subject.',1],
  [31,4,8,'The Socratic Tutor','GPT-4o',0,9200,4.7,'5/4','Leads learners to the answer with questions calibrated to the right difficulty.',1],
  [276,3,2,'Product Shot, White BG','Flux',900,1500,4.8,'1/1','Clean commerce hero shots with soft contact shadow and precise product edges.',0],
  [212,2,4,"The Worldbuilder's Bible",'GPT-4o',2900,720,5,'4/5','Builds consistent geography, factions, and history while preserving continuity.',1],
  [248,1,3,'Vintage Film Poster','Midjourney',1300,2200,4.9,'3/4','Seventies grain, bold typography, and halftone one-sheets with archival character.',1],
  [156,4,5,'Bug-to-Test Generator','GPT-4o',1500,1900,4.8,'4/3','Turns a bug report into a failing test, a focused fix, and relevant edge cases.',0],
  [267,3,2,'Dreamy Bokeh Portrait','Flux',1000,1700,4.8,'4/5','Creamy backgrounds, warm late-day light, and eyes in precise focus.',0],
  [101,4,7,'Meeting to Memo','Claude',600,5100,4.7,'4/3','Turns a messy transcript into a crisp decision memo with owners and dates.',1],
  [290,1,1,'Concept Car, Studio','Midjourney',1200,1400,4.8,'3/2','Automotive design studies with believable reflections and a tangible sense of scale.',0],
  [77,2,4,'The Plot Doctor','Claude',1600,1400,4.9,'1/1','Diagnoses stalled stories and prescribes focused fixes for stakes and pacing.',0],
  [221,3,1,'Watercolor Cityscape','Flux',900,2000,4.9,'3/4','Loose luminous washes, confident linework, soft skies, and busy streets.',0],
  [63,4,7,'Inbox Zero Strategist','Claude',800,3400,4.6,'4/3','Triages and schedules a full inbox in one pass, ordered by weekly impact.',0],
] as const

export function seedDatabase(db: Database.Database) {
  const insertCreator = db.prepare('INSERT OR IGNORE INTO creators VALUES (?, ?, ?, ?)')
  creators.forEach((row) => insertCreator.run(...row))
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?)')
  categories.forEach((name, index) => insertCategory.run(index + 1, name))
  const insertPrompt = db.prepare(`INSERT OR IGNORE INTO prompts
    (id,creator_id,category_id,title,model,price_cents,sold,rating,aspect_ratio,description,featured,created_at,image)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  prompts.forEach((row, index) => insertPrompt.run(...row, `2025-${String((index % 9) + 1).padStart(2, '0')}-${String((index % 24) + 1).padStart(2, '0')}`, `/media/prompt-${String((index % 8) + 1).padStart(2, '0')}.jpg`))

  db.prepare("INSERT OR IGNORE INTO users VALUES (1, 'demo@powerprompt.local', 'Demo Collector')").run()
  db.prepare("INSERT OR IGNORE INTO users VALUES (2, 'maker@powerprompt.local', 'Prompt Maker')").run()
  db.prepare("INSERT OR IGNORE INTO favorites VALUES (1, 207, '2025-09-02')").run()
  db.prepare("INSERT OR IGNORE INTO favorites VALUES (1, 160, '2025-09-04')").run()
  db.prepare("INSERT OR IGNORE INTO cart_items VALUES (1, 142, 1, '2025-09-06')").run()

  const orderCount = db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }
  if (!orderCount.count) seedSales(db)
}

function seedSales(db: Database.Database) {
  const orderRows = [
    [2,'buyer1@example.com',2100,105,2205,'2025-09-01T10:00:00Z',207,1,1,2,900],
    [2,'buyer2@example.com',2400,120,2520,'2025-09-02T11:00:00Z',189,2,6,1,2400],
    [1,'buyer3@example.com',3000,150,3150,'2025-09-03T12:00:00Z',211,1,1,2,1500],
    [1,'buyer4@example.com',1800,90,1890,'2025-09-04T13:00:00Z',160,4,5,1,1800],
    [2,'buyer5@example.com',2900,145,3045,'2025-09-05T14:00:00Z',212,2,4,1,2900],
    [1,'buyer6@example.com',2400,120,2520,'2025-09-06T15:00:00Z',142,2,6,2,1200],
  ] as const
  const addOrder = db.prepare("INSERT INTO orders (user_id,email,status,subtotal_cents,fee_cents,total_cents,created_at) VALUES (?,?,'paid',?,?,?,?)")
  const addItem = db.prepare('INSERT INTO order_items VALUES (?,?,?,?,?,?)')
  orderRows.forEach(([user,email,subtotal,fee,total,date,prompt,creator,category,qty,unit]) => {
    const result = addOrder.run(user,email,subtotal,fee,total,date)
    addItem.run(result.lastInsertRowid,prompt,creator,category,qty,unit)
  })
  const addSession = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)')
  for (let i = 1; i <= 30; i += 1) addSession.run(i, i % 3 ? 1 : 2, i <= 6 ? 1 : 0, `2025-09-${String((i % 6) + 1).padStart(2, '0')}T09:00:00Z`)
}
