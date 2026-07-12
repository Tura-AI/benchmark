import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { creators, orderItemSeeds, orderSeeds, prompts } from './seed'

const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS creators(id INTEGER PRIMARY KEY, name TEXT NOT NULL, handle TEXT NOT NULL, profile_views INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS prompts(id INTEGER PRIMARY KEY,title TEXT NOT NULL,model TEXT NOT NULL,category_id INTEGER NOT NULL,price REAL NOT NULL,sold INTEGER NOT NULL,rating REAL NOT NULL,creator_id INTEGER NOT NULL,aspect_ratio TEXT NOT NULL,description TEXT NOT NULL,image TEXT NOT NULL,featured INTEGER NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(category_id) REFERENCES categories(id),FOREIGN KEY(creator_id) REFERENCES creators(id));
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER NOT NULL,prompt_id INTEGER NOT NULL,PRIMARY KEY(user_id,prompt_id));
CREATE TABLE IF NOT EXISTS cart_items(user_id INTEGER NOT NULL,prompt_id INTEGER NOT NULL,quantity INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(user_id,prompt_id));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,status TEXT NOT NULL,subtotal REAL NOT NULL DEFAULT 0,fee REAL NOT NULL DEFAULT 0,total REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_items(order_id INTEGER NOT NULL,prompt_id INTEGER NOT NULL,price REAL NOT NULL,quantity INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(order_id,prompt_id));
CREATE INDEX IF NOT EXISTS idx_prompts_catalog ON prompts(model,category_id,featured,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders(status,created_at);
`

let active: Database.Database | undefined
let activePath = ''

export function getDb() {
  const path = process.env.POWERPROMPT_DB ?? resolve('data/powerprompt.db')
  if (active && activePath === path) return active
  if (active) active.close()
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  active = new Database(path)
  activePath = path
  active.pragma('journal_mode = WAL')
  active.exec(schema)
  seed(active)
  return active
}

function seed(db: Database.Database) {
  if ((db.prepare('SELECT COUNT(*) count FROM prompts').get() as {count:number}).count) return
  db.transaction(() => {
    db.prepare('INSERT INTO users VALUES(1,?)').run('Demo Collector')
    const creatorStmt=db.prepare('INSERT INTO creators VALUES(?,?,?,?)')
    creators.forEach((row)=>creatorStmt.run(...row))
    const cats=[...new Set(prompts.map(p=>p.category))]
    const catStmt=db.prepare('INSERT INTO categories(id,name) VALUES(?,?)')
    cats.forEach((name,index)=>catStmt.run(index+1,name))
    const catIds=new Map(cats.map((name,index)=>[name,index+1]))
    const promptStmt=db.prepare('INSERT INTO prompts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    prompts.forEach(p=>promptStmt.run(p.id,p.title,p.model,catIds.get(p.category),p.price,p.sold,p.rating,p.creatorId,p.aspectRatio,p.description,p.image,p.featured,p.createdAt))
    db.prepare('INSERT INTO favorites VALUES(1,207),(1,31),(1,211)').run()
    db.prepare('INSERT INTO cart_items VALUES(1,142,1)').run()
    const orderStmt=db.prepare('INSERT INTO orders(id,user_id,status,created_at) VALUES(?,?,?,?)')
    orderSeeds.forEach(row=>orderStmt.run(...row))
    const itemStmt=db.prepare('INSERT INTO order_items(order_id,prompt_id,price) VALUES(?,?,?)')
    orderItemSeeds.forEach(row=>itemStmt.run(...row))
    db.prepare(`UPDATE orders SET subtotal=(SELECT COALESCE(SUM(price*quantity),0) FROM order_items WHERE order_id=orders.id),fee=ROUND((SELECT COALESCE(SUM(price*quantity),0) FROM order_items WHERE order_id=orders.id)*.08,2),total=ROUND((SELECT COALESCE(SUM(price*quantity),0) FROM order_items WHERE order_id=orders.id)*1.08,2)`).run()
  })()
}

export function resetDbForTests() {
  active?.close(); active=undefined; activePath=''
}
