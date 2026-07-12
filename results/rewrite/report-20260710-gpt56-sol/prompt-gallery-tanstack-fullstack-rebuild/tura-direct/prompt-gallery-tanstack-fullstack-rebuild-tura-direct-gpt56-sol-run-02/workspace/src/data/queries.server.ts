import type { CatalogFilters, CartSummary, PromptRecord } from './contracts'
import { getDb } from './db.server'

const selectPrompt = `SELECT p.id,p.title,p.model,c.name category,p.price,p.sold,p.rating,cr.name creator,cr.id creatorId,p.aspect_ratio aspectRatio,p.description,p.image,p.featured,p.created_at createdAt,
ROW_NUMBER() OVER(ORDER BY p.featured DESC,p.sold DESC,p.rating DESC) rank,
EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=1 AND f.prompt_id=p.id) isFavorite,
EXISTS(SELECT 1 FROM cart_items ci WHERE ci.user_id=1 AND ci.prompt_id=p.id) inCart
FROM prompts p JOIN categories c ON c.id=p.category_id JOIN creators cr ON cr.id=p.creator_id`

export function listPrompts(filters: CatalogFilters = {}) {
  const where:string[]=[]; const values:unknown[]=[]
  if(filters.model && filters.model!=='All'){where.push('p.model=?');values.push(filters.model)}
  if(filters.category && filters.category!=='All'){where.push('c.name=?');values.push(filters.category)}
  if(filters.q){where.push('(p.title LIKE ? OR p.description LIKE ? OR cr.name LIKE ?)'); const q=`%${filters.q}%`;values.push(q,q,q)}
  if(filters.favorites) where.push('EXISTS(SELECT 1 FROM favorites fx WHERE fx.user_id=1 AND fx.prompt_id=p.id)')
  if(filters.price==='free') where.push('p.price=0')
  if(filters.price==='paid') where.push('p.price>0')
  const order=filters.sort==='newest'?'p.created_at DESC':filters.sort==='popular'?'p.sold DESC':'p.featured DESC,p.sold DESC'
  return getDb().prepare(`${selectPrompt}${where.length?` WHERE ${where.join(' AND ')}`:''} ORDER BY ${order}`).all(...values) as PromptRecord[]
}

export function getPrompt(id:number){return getDb().prepare(`${selectPrompt} WHERE p.id=?`).get(id) as PromptRecord|undefined}
export function getCategories(){return getDb().prepare('SELECT c.name,COUNT(p.id) count FROM categories c LEFT JOIN prompts p ON p.category_id=c.id GROUP BY c.id ORDER BY count DESC,c.name').all() as {name:string,count:number}[]}
export function getCatalogCounts(){return getDb().prepare('SELECT COUNT(*) total,SUM(price=0) free,SUM(price>0) paid,SUM(featured=1) featured FROM prompts').get() as {total:number,free:number,paid:number,featured:number}}

export function toggleFavorite(promptId:number){
  const db=getDb(); const row=db.prepare('SELECT 1 FROM favorites WHERE user_id=1 AND prompt_id=?').get(promptId)
  row?db.prepare('DELETE FROM favorites WHERE user_id=1 AND prompt_id=?').run(promptId):db.prepare('INSERT INTO favorites VALUES(1,?)').run(promptId)
  return {favorite:!row}
}
export function toggleCart(promptId:number){
  const db=getDb(); const row=db.prepare('SELECT 1 FROM cart_items WHERE user_id=1 AND prompt_id=?').get(promptId)
  row?db.prepare('DELETE FROM cart_items WHERE user_id=1 AND prompt_id=?').run(promptId):db.prepare('INSERT INTO cart_items VALUES(1,?,1)').run(promptId)
  return {inCart:!row,...getCartTotals()}
}
export function getCartTotals():CartSummary{
  const db=getDb()
  const items=db.prepare(`${selectPrompt} JOIN cart_items cart ON cart.prompt_id=p.id AND cart.user_id=1`).all() as Array<PromptRecord & {quantity:number}>
  const totals=db.prepare('SELECT ROUND(COALESCE(SUM(p.price*ci.quantity),0),2) subtotal,ROUND(COALESCE(SUM(p.price*ci.quantity),0)*.08,2) fee,ROUND(COALESCE(SUM(p.price*ci.quantity),0)*1.08,2) total FROM cart_items ci JOIN prompts p ON p.id=ci.prompt_id WHERE ci.user_id=1').get() as Omit<CartSummary,'items'>
  return {...totals,items}
}
export function checkout(){
  const db=getDb(); const cart=getCartTotals(); if(!cart.items.length) throw new Error('Cart is empty')
  return db.transaction(()=>{const row=db.prepare("INSERT INTO orders(user_id,status,subtotal,fee,total,created_at) VALUES(1,'completed',?,?,?,datetime('now')) RETURNING id").get(cart.subtotal,cart.fee,cart.total) as {id:number}; const stmt=db.prepare('INSERT INTO order_items VALUES(?,?,?,1)'); cart.items.forEach(i=>stmt.run(row.id,i.id,i.price)); db.prepare('DELETE FROM cart_items WHERE user_id=1').run(); return {orderId:row.id,...cart}})()
}

export function getAnalytics(){
  const db=getDb()
  const summary=db.prepare(`SELECT ROUND(COALESCE(SUM(total),0),2) revenue,COUNT(*) orders,ROUND(COALESCE(AVG(total),0),2) averageOrderValue FROM orders WHERE status='completed'`).get() as {revenue:number;orders:number;averageOrderValue:number}
  const creators=db.prepare(`SELECT cr.id,cr.name,ROUND(COALESCE(SUM(oi.price*oi.quantity*.8),0),2) revenue,COALESCE(SUM(oi.quantity),0) sales,ROUND(COALESCE(SUM(oi.quantity)*100.0/cr.profile_views,0),2) conversionRate FROM creators cr LEFT JOIN prompts p ON p.creator_id=cr.id LEFT JOIN order_items oi ON oi.prompt_id=p.id LEFT JOIN orders o ON o.id=oi.order_id AND o.status='completed' GROUP BY cr.id ORDER BY revenue DESC`).all() as {id:number;name:string;revenue:number;sales:number;conversionRate:number}[]
  const categories=db.prepare(`SELECT c.name,ROUND(COALESCE(SUM(oi.price*oi.quantity),0),2) revenue,COALESCE(SUM(oi.quantity),0) sales FROM categories c LEFT JOIN prompts p ON p.category_id=c.id LEFT JOIN order_items oi ON oi.prompt_id=p.id LEFT JOIN orders o ON o.id=oi.order_id AND o.status='completed' GROUP BY c.id ORDER BY revenue DESC`).all() as {name:string;revenue:number;sales:number}[]
  const daily=db.prepare(`SELECT date(created_at) date,ROUND(SUM(total),2) revenue,COUNT(*) orders FROM orders WHERE status='completed' GROUP BY date(created_at) ORDER BY date(created_at)`).all() as {date:string;revenue:number;orders:number}[]
  return {summary,creators,categories,daily}
}
