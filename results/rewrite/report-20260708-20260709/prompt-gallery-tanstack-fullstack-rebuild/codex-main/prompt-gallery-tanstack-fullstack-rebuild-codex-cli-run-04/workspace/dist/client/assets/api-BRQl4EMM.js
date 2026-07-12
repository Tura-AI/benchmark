import{n as e,t}from"./rolldown-runtime-Bh1tDfsg.js";var n=e(t(((e,t)=>{t.exports={}}))(),1),r=[{id:1,name:`Atlas Studio`,handle:`atlas`,commissionRate:.85},{id:2,name:`Lumen`,handle:`lumen`,commissionRate:.85},{id:3,name:`Field & Co.`,handle:`field`,commissionRate:.85},{id:4,name:`Ops Guild`,handle:`ops`,commissionRate:.85}],i=[`Image`,`Photography`,`Design`,`Writing`,`Code`,`Marketing`,`Productivity`,`Research`],a=[[207,`Cinematic Still, 35mm`,`Midjourney`,`Image`,9,4700,5,1,`3/4`,`Film-grade stills with real lens language, focal length, grain, and lighting that reads as cinema.`,1,`2026-06-27`],[233,`Ink Wash Warrior`,`Midjourney`,`Image`,12,2100,4.9,1,`2/3`,`Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space.`,1,`2026-06-30`],[174,`Editorial Photo Grade`,`Flux`,`Photography`,11,1300,4.9,2,`3/4`,`Magazine-style color grading with warm skin, deep shadow, and a quiet print look.`,0,`2026-07-01`],[301,`Magazine Cover Maker`,`GPT-4o`,`Design`,14,3300,4.8,3,`4/5`,`Drop in a photo, get a full cover: masthead, cover lines, barcode, the works.`,1,`2026-07-07`],[118,`Studio Portrait, Soft Light`,`Flux`,`Photography`,10,1800,4.9,2,`4/5`,`Clean beauty light with believable falloff. Looks shot, not rendered.`,1,`2026-06-26`],[198,`Logo Sketch, Mono-line`,`Midjourney`,`Design`,13,980,4.8,3,`1/1`,`Single-weight line marks with real negative-space thinking. Vector-ready directions, fast.`,0,`2026-07-02`],[142,`The Cold-Email Closer`,`GPT-4o`,`Marketing`,12,2300,4.9,3,`4/3`,`Cold emails that actually get replies with tested subject-line variants baked in.`,1,`2026-07-04`],[160,`Senior Code Reviewer`,`Claude`,`Code`,18,1100,4.8,4,`1/1`,`Reviews your diff like a staff engineer, catches risk, suggests fixes, explains the why.`,0,`2026-07-03`],[255,`Neon Street, Night`,`Flux`,`Photography`,8,2600,4.7,2,`3/4`,`Rain-slick neon with real reflections and grain. A cinematic night street look.`,1,`2026-07-05`],[189,`Brand Voice, Bottled`,`Claude`,`Marketing`,24,860,4.9,3,`4/3`,`Feed it three samples; get a reusable voice guide that writes in your exact tone.`,1,`2026-06-29`],[211,`Anime Key Visual`,`Midjourney`,`Image`,15,3900,5,1,`2/3`,`Poster-grade key art with depth, rim light, and a real focal subject.`,1,`2026-07-06`],[31,`The Socratic Tutor`,`GPT-4o`,`Research`,0,9200,4.7,4,`5/4`,`Never hands you the answer. Leads you there with questions at the right difficulty.`,1,`2026-06-24`],[276,`Product Shot, White BG`,`Flux`,`Photography`,9,1500,4.8,2,`1/1`,`Clean e-commerce hero shots with soft contact shadow. Drop-in ready for storefronts.`,0,`2026-07-08`],[212,`The Worldbuilder's Bible`,`GPT-4o`,`Writing`,29,720,5,4,`4/5`,`Builds a consistent fictional world: geography, factions, history, and continuity.`,1,`2026-06-28`],[248,`Vintage Film Poster`,`Midjourney`,`Design`,13,2200,4.9,3,`3/4`,`70s grain, bold type, halftone. One-sheets that look pulled from an archive.`,1,`2026-07-01`],[156,`Bug-to-Test Generator`,`GPT-4o`,`Code`,15,1900,4.8,4,`4/3`,`Paste a bug report, get a failing test plus the fix and edge cases.`,0,`2026-07-06`],[267,`Dreamy Bokeh Portrait`,`Flux`,`Photography`,10,1700,4.8,2,`4/5`,`Creamy backgrounds, golden-hour warmth, eyes in razor focus.`,1,`2026-07-03`],[101,`Meeting -> Memo`,`Claude`,`Productivity`,6,5100,4.7,4,`4/3`,`Turns a messy transcript into a crisp decision memo: owners, dates, and next steps.`,1,`2026-07-02`]],o=[[`2026-07-01`,207,9,12],[`2026-07-01`,31,0,30],[`2026-07-02`,101,6,18],[`2026-07-02`,142,12,10],[`2026-07-03`,160,18,7],[`2026-07-03`,267,10,11],[`2026-07-04`,211,15,16],[`2026-07-05`,255,8,20],[`2026-07-06`,301,14,14],[`2026-07-06`,156,15,9],[`2026-07-07`,189,24,6],[`2026-07-08`,276,9,12]],s=n.default.join(process.cwd(),`data`,`powerprompt.sqlite`),c;function l(){return c||(n.default.mkdirSync(n.default.dirname(s),{recursive:!0}),c=new n.DatabaseSync(s),c.exec(`PRAGMA journal_mode = WAL`),u(c),d(c)),c}function u(e){e.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creators (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      commission_rate REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      price REAL NOT NULL,
      sold INTEGER NOT NULL,
      rating REAL NOT NULL,
      creator_id INTEGER NOT NULL REFERENCES creators(id),
      aspect_ratio TEXT NOT NULL,
      description TEXT NOT NULL,
      featured INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      prompt_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id INTEGER NOT NULL,
      prompt_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ordered_at TEXT NOT NULL,
      subtotal REAL NOT NULL,
      fee REAL NOT NULL,
      total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id INTEGER REFERENCES prompts(id),
      visited_at TEXT NOT NULL
    );
  `)}function d(e){e.prepare(`SELECT COUNT(*) as c FROM prompts`).get().c>0||(()=>{e.exec(`BEGIN`);try{e.prepare(`INSERT INTO users (id, name) VALUES (1, ?)`).run(`Demo buyer`);let t=e.prepare(`INSERT INTO categories (id, name) VALUES (?, ?)`);i.forEach((e,n)=>t.run(n+1,e));let n=e.prepare(`INSERT INTO creators (id, name, handle, commission_rate) VALUES (?, ?, ?, ?)`);r.forEach(e=>n.run(e.id,e.name,e.handle,e.commissionRate));let s=e.prepare(`
      INSERT INTO prompts
      (id, title, model, category_id, price, sold, rating, creator_id, aspect_ratio, description, featured, created_at)
      VALUES (?, ?, ?, (SELECT id FROM categories WHERE name = ?), ?, ?, ?, ?, ?, ?, ?, ?)
    `);a.forEach(e=>s.run(...e)),e.prepare(`INSERT INTO favorites (user_id, prompt_id) VALUES (1, 31), (1, 211), (1, 301)`).run(),e.prepare(`INSERT INTO cart_items (user_id, prompt_id, quantity) VALUES (1, 207, 1), (1, 142, 1)`).run();let c=e.prepare(`INSERT INTO orders (user_id, ordered_at, subtotal, fee, total) VALUES (1, ?, ?, ?, ?)`),l=e.prepare(`INSERT INTO order_items (order_id, prompt_id, quantity, unit_price) VALUES (?, ?, ?, ?)`);o.forEach(([e,t,n,r])=>{let i=Number(n)*Number(r),a=Math.round(i*.06*100)/100,o=c.run(e,i,a,i+a);l.run(o.lastInsertRowid,t,r,n)});let u=e.prepare(`INSERT INTO visits (prompt_id, visited_at) VALUES (?, ?)`);a.forEach((e,t)=>{let n=25+Number(e[5])%50;for(let r=0;r<n;r++)u.run(e[0],`2026-07-0${t%8+1}`)}),e.exec(`COMMIT`)}catch(t){throw e.exec(`ROLLBACK`),t}})()}function f(e,t){let[n,r]=t.split(`/`).map(Number);return`https://picsum.photos/seed/powerprompt-${e}/640/${Math.round(640*r/n)}`}function p(){return l().prepare(`SELECT c.name, COUNT(p.id) count
       FROM categories c LEFT JOIN prompts p ON p.category_id = c.id
       GROUP BY c.id ORDER BY c.id`).all()}function m(e={}){let t=e.userId??1,n=e.model??`all`,r=e.category??`all`,i=`%${(e.search??``).toLowerCase()}%`,a=+!!e.favoritesOnly,o=+!!e.freeOnly,s=e.sort===`newest`?`p.created_at DESC, p.id DESC`:e.sort===`popular`?`p.rating DESC, p.sold DESC`:`rankScore DESC, p.featured DESC`;return l().prepare(`
      SELECT p.id, p.title, p.model, c.name category, p.price, p.sold, p.rating,
        cr.name creator, cr.id creatorId, p.aspect_ratio aspectRatio, p.description,
        p.featured, p.created_at createdAt,
        ROUND((p.rating * 20) + (p.sold / 120.0) + (p.featured * 35) - (p.price * 0.28), 2) rankScore,
        CASE WHEN f.prompt_id IS NULL THEN 0 ELSE 1 END isFavorite,
        CASE WHEN ci.prompt_id IS NULL THEN 0 ELSE 1 END inCart
      FROM prompts p
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      LEFT JOIN favorites f ON f.prompt_id = p.id AND f.user_id = ?
      LEFT JOIN cart_items ci ON ci.prompt_id = p.id AND ci.user_id = ?
      WHERE (? = 'all' OR p.model = ?)
        AND (? = 'all' OR c.name = ?)
        AND (? = 0 OR p.price = 0)
        AND (? = 0 OR f.prompt_id IS NOT NULL)
        AND (LOWER(p.title || ' ' || p.model || ' ' || c.name || ' ' || p.description || ' ' || cr.name) LIKE ?)
      ORDER BY ${s}
    `).all(t,t,n,n,r,r,o,a,i).map(e=>({...e,imageUrl:f(e.id,e.aspectRatio)}))}function h(e,t=1){return m({userId:t}).find(t=>t.id===e)??null}function g(e=1){let t=l().prepare(`
      SELECT p.id, p.title, p.model, c.name category, p.price, ci.quantity,
        cr.name creator, p.aspect_ratio aspectRatio,
        ROUND(p.price * ci.quantity, 2) lineTotal
      FROM cart_items ci
      JOIN prompts p ON p.id = ci.prompt_id
      JOIN categories c ON c.id = p.category_id
      JOIN creators cr ON cr.id = p.creator_id
      WHERE ci.user_id = ?
      ORDER BY ci.created_at DESC
    `).all(e),n=l().prepare(`
      SELECT
        ROUND(COALESCE(SUM(p.price * ci.quantity), 0), 2) subtotal,
        ROUND(COALESCE(SUM(p.price * ci.quantity), 0) * 0.06, 2) fee,
        ROUND(COALESCE(SUM(p.price * ci.quantity), 0) * 1.06, 2) total,
        COALESCE(SUM(ci.quantity), 0) count
      FROM cart_items ci JOIN prompts p ON p.id = ci.prompt_id
      WHERE ci.user_id = ?
    `).get(e);return{items:t.map(e=>({...e,imageUrl:f(e.id,e.aspectRatio)})),totals:n}}function _(){let e=l();return{summary:e.prepare(`
      SELECT
        COUNT(DISTINCT o.id) orders,
        ROUND(SUM(o.total), 2) grossRevenue,
        ROUND(AVG(o.total), 2) averageOrderValue,
        (SELECT COUNT(*) FROM visits) visits,
        ROUND(COUNT(DISTINCT o.id) * 100.0 / (SELECT COUNT(*) FROM visits), 2) conversionRate
      FROM orders o
    `).get(),creators:e.prepare(`
      SELECT cr.name, cr.handle,
        ROUND(SUM(oi.quantity * oi.unit_price), 2) gross,
        ROUND(SUM(oi.quantity * oi.unit_price * cr.commission_rate), 2) creatorRevenue,
        SUM(oi.quantity) units
      FROM order_items oi
      JOIN prompts p ON p.id = oi.prompt_id
      JOIN creators cr ON cr.id = p.creator_id
      GROUP BY cr.id
      ORDER BY creatorRevenue DESC
    `).all(),categories:e.prepare(`
      SELECT c.name, ROUND(SUM(oi.quantity * oi.unit_price), 2) revenue, SUM(oi.quantity) units
      FROM order_items oi
      JOIN prompts p ON p.id = oi.prompt_id
      JOIN categories c ON c.id = p.category_id
      GROUP BY c.id ORDER BY revenue DESC
    `).all(),daily:e.prepare(`
      SELECT ordered_at day, ROUND(SUM(total), 2) revenue, COUNT(*) orders
      FROM orders GROUP BY ordered_at ORDER BY ordered_at
    `).all(),modelMix:e.prepare(`
      SELECT p.model, SUM(oi.quantity) units, ROUND(SUM(oi.quantity * oi.unit_price), 2) revenue
      FROM order_items oi JOIN prompts p ON p.id = oi.prompt_id
      GROUP BY p.model ORDER BY revenue DESC
    `).all()}}function v(e={}){return{prompts:m(e),categories:p(),cart:g()}}function y(e){return{prompt:h(e),cart:g()}}var b=()=>g(),x=()=>_();export{x as analyticsApi,b as cartApi,y as promptDetailApi,v as storefrontApi};