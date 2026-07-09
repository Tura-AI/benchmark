import { z } from "zod";
//#region src/server/seed.ts
var demoUserId = "user-demo";
var creators = [
	{
		id: "cr-aurora",
		name: "Mira Vale",
		handle: "@aurora",
		specialty: "Fashion campaigns",
		avatar: "MV"
	},
	{
		id: "cr-studio",
		name: "Jun Park",
		handle: "@studiojun",
		specialty: "Product scenes",
		avatar: "JP"
	},
	{
		id: "cr-frame",
		name: "Noa Ellis",
		handle: "@framecraft",
		specialty: "Editorial portraits",
		avatar: "NE"
	},
	{
		id: "cr-luma",
		name: "Inez Cole",
		handle: "@luma",
		specialty: "Cinematic looks",
		avatar: "IC"
	}
];
var categories = [
	{
		id: "makeup",
		name: "Makeup",
		color: "#c9fa46"
	},
	{
		id: "fashion",
		name: "Fashion",
		color: "#f0b7c9"
	},
	{
		id: "product",
		name: "Product",
		color: "#b7d9f0"
	},
	{
		id: "portrait",
		name: "Portrait",
		color: "#e2c7ff"
	},
	{
		id: "video",
		name: "Video",
		color: "#f4ce79"
	}
];
var prompts = [
	{
		id: "p-001",
		title: "Gloss Editorial Makeup Shoot",
		slug: "gloss-editorial-makeup-shoot",
		model: "GPT-4o",
		categoryId: "makeup",
		creatorId: "cr-frame",
		priceCents: 1900,
		featured: 1,
		ratio: "4 / 5",
		sales: 184,
		views: 4200,
		rating: 4.9,
		createdAt: "2026-06-20",
		image: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=900&q=80",
		description: "A structured prompt for close editorial beauty images with gloss texture, clean skin detail, and controlled product language.",
		tags: "beauty,skin,editorial,gloss"
	},
	{
		id: "p-002",
		title: "Chrome Lip Macro Builder",
		slug: "chrome-lip-macro-builder",
		model: "Midjourney",
		categoryId: "makeup",
		creatorId: "cr-aurora",
		priceCents: 1200,
		featured: 1,
		ratio: "1 / 1",
		sales: 211,
		views: 5100,
		rating: 4.8,
		createdAt: "2026-06-26",
		image: "https://images.unsplash.com/photo-1583001931096-959e9a1a6223?auto=format&fit=crop&w=900&q=80",
		description: "Macro prompt pack for reflective lip finishes, precision lighting, and cosmetic campaign framing.",
		tags: "lip,macro,chrome,campaign"
	},
	{
		id: "p-003",
		title: "Soft Studio Foundation Test",
		slug: "soft-studio-foundation-test",
		model: "Claude",
		categoryId: "product",
		creatorId: "cr-studio",
		priceCents: 0,
		featured: 0,
		ratio: "3 / 4",
		sales: 92,
		views: 2700,
		rating: 4.6,
		createdAt: "2026-06-27",
		image: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=900&q=80",
		description: "Free evaluation prompt for shade range product images and softly diffused studio backgrounds.",
		tags: "foundation,product,free,studio"
	},
	{
		id: "p-004",
		title: "Flux Beauty Lookbook System",
		slug: "flux-beauty-lookbook-system",
		model: "Flux",
		categoryId: "fashion",
		creatorId: "cr-luma",
		priceCents: 2400,
		featured: 1,
		ratio: "5 / 7",
		sales: 156,
		views: 3900,
		rating: 4.7,
		createdAt: "2026-07-01",
		image: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
		description: "A repeatable image system for makeup-led fashion lookbooks with consistent styling and lighting.",
		tags: "flux,fashion,lookbook,makeup"
	},
	{
		id: "p-005",
		title: "Luxury Compact Product Render",
		slug: "luxury-compact-product-render",
		model: "GPT-4o",
		categoryId: "product",
		creatorId: "cr-studio",
		priceCents: 1600,
		featured: 0,
		ratio: "16 / 11",
		sales: 121,
		views: 3100,
		rating: 4.7,
		createdAt: "2026-06-19",
		image: "https://images.unsplash.com/photo-1631214524049-0ebbbe6d81aa?auto=format&fit=crop&w=1000&q=80",
		description: "Prompt recipe for premium cosmetic packshots with ingredient cues and high-end surface control.",
		tags: "product,luxury,packshot,cosmetics"
	},
	{
		id: "p-006",
		title: "Creator UGC Beauty Script",
		slug: "creator-ugc-beauty-script",
		model: "Claude",
		categoryId: "video",
		creatorId: "cr-aurora",
		priceCents: 900,
		featured: 0,
		ratio: "9 / 12",
		sales: 75,
		views: 2100,
		rating: 4.5,
		createdAt: "2026-07-02",
		image: "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=900&q=80",
		description: "Shot-by-shot prompt and copy framework for beauty creator videos and product demonstrations.",
		tags: "ugc,video,script,beauty"
	},
	{
		id: "p-007",
		title: "Clean Girl Portrait Prompt",
		slug: "clean-girl-portrait-prompt",
		model: "Midjourney",
		categoryId: "portrait",
		creatorId: "cr-frame",
		priceCents: 1400,
		featured: 1,
		ratio: "4 / 6",
		sales: 198,
		views: 4700,
		rating: 4.9,
		createdAt: "2026-07-04",
		image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=80",
		description: "Balanced portrait prompt for natural skin, minimal makeup styling, and believable soft daylight.",
		tags: "portrait,natural,daylight,skin"
	},
	{
		id: "p-008",
		title: "High-Contrast Mascara Campaign",
		slug: "high-contrast-mascara-campaign",
		model: "Flux",
		categoryId: "makeup",
		creatorId: "cr-luma",
		priceCents: 1800,
		featured: 0,
		ratio: "2 / 3",
		sales: 142,
		views: 3550,
		rating: 4.6,
		createdAt: "2026-06-22",
		image: "https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=900&q=80",
		description: "Prompt for bold eye-focused cosmetic visuals with clean composition and campaign-safe contrast.",
		tags: "mascara,eyes,campaign,contrast"
	},
	{
		id: "p-009",
		title: "Skincare Texture Flatlay",
		slug: "skincare-texture-flatlay",
		model: "GPT-4o",
		categoryId: "product",
		creatorId: "cr-studio",
		priceCents: 0,
		featured: 0,
		ratio: "1 / 1",
		sales: 66,
		views: 1800,
		rating: 4.4,
		createdAt: "2026-06-18",
		image: "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=900&q=80",
		description: "Free starter prompt for cream textures, flatlay composition, and ingredient-led cosmetic imagery.",
		tags: "skincare,texture,flatlay,free"
	},
	{
		id: "p-010",
		title: "Runway Backstage Beauty",
		slug: "runway-backstage-beauty",
		model: "Midjourney",
		categoryId: "fashion",
		creatorId: "cr-aurora",
		priceCents: 2100,
		featured: 1,
		ratio: "16 / 10",
		sales: 173,
		views: 4100,
		rating: 4.8,
		createdAt: "2026-07-05",
		image: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=1000&q=80",
		description: "Backstage fashion prompt with realistic makeup prep, textile context, and documentary lighting.",
		tags: "runway,backstage,fashion,beauty"
	},
	{
		id: "p-011",
		title: "Minimal Beauty Ad Copy Matrix",
		slug: "minimal-beauty-ad-copy-matrix",
		model: "Claude",
		categoryId: "makeup",
		creatorId: "cr-luma",
		priceCents: 1100,
		featured: 0,
		ratio: "7 / 8",
		sales: 88,
		views: 2500,
		rating: 4.5,
		createdAt: "2026-06-30",
		image: "https://images.unsplash.com/photo-1567721913486-6585f069b332?auto=format&fit=crop&w=900&q=80",
		description: "A structured Claude prompt for short beauty ad variants, claims-safe copy, and tone control.",
		tags: "copy,ads,beauty,claims"
	},
	{
		id: "p-012",
		title: "Serum Launch Landing Imagery",
		slug: "serum-launch-landing-imagery",
		model: "Flux",
		categoryId: "product",
		creatorId: "cr-frame",
		priceCents: 2600,
		featured: 1,
		ratio: "5 / 4",
		sales: 227,
		views: 5500,
		rating: 4.9,
		createdAt: "2026-07-06",
		image: "https://images.unsplash.com/photo-1570194065650-d99fb4bedf0a?auto=format&fit=crop&w=1000&q=80",
		description: "Premium launch prompt for serum bottles, tactile surfaces, and polished ecommerce hero imagery.",
		tags: "serum,launch,ecommerce,hero"
	}
];
var seedOrders = [
	[
		"ord-001",
		demoUserId,
		4700,
		282,
		4982,
		"paid",
		"2026-07-01"
	],
	[
		"ord-002",
		demoUserId,
		3500,
		210,
		3710,
		"paid",
		"2026-07-02"
	],
	[
		"ord-003",
		demoUserId,
		6200,
		372,
		6572,
		"paid",
		"2026-07-03"
	],
	[
		"ord-004",
		demoUserId,
		2600,
		156,
		2756,
		"paid",
		"2026-07-06"
	]
];
var seedOrderItems = [
	[
		"ord-001",
		"p-001",
		1900
	],
	[
		"ord-001",
		"p-004",
		2400
	],
	[
		"ord-001",
		"p-003",
		0
	],
	[
		"ord-001",
		"p-006",
		900
	],
	[
		"ord-002",
		"p-002",
		1200
	],
	[
		"ord-002",
		"p-007",
		1400
	],
	[
		"ord-002",
		"p-011",
		1100
	],
	[
		"ord-003",
		"p-010",
		2100
	],
	[
		"ord-003",
		"p-012",
		2600
	],
	[
		"ord-003",
		"p-008",
		1800
	],
	[
		"ord-004",
		"p-012",
		2600
	]
];
//#endregion
//#region src/server/queries.ts
var CatalogInput = z.object({
	model: z.string().default("all"),
	category: z.string().default("all"),
	sort: z.enum([
		"Featured",
		"Newest",
		"Popular"
	]).default("Featured"),
	search: z.string().default(""),
	favoritesOnly: z.boolean().default(false)
});
var feeRate = .06;
function listCatalog(db, raw = {}) {
	const input = CatalogInput.parse(raw);
	const where = [];
	const params = { userId: demoUserId };
	if (input.model !== "all") {
		where.push("p.model = @model");
		params.model = input.model;
	}
	if (input.category !== "all") {
		where.push("p.category_id = @category");
		params.category = input.category;
	}
	if (input.search) {
		where.push("(p.title like @q or p.description like @q or p.tags like @q)");
		params.q = `%${input.search}%`;
	}
	if (input.favoritesOnly) where.push("f.prompt_id is not null");
	const orderBy = input.sort === "Newest" ? "date(p.created_at) desc, p.title asc" : input.sort === "Popular" ? "p.sales desc, p.rating desc, p.title asc" : "rank_score desc, p.featured desc, p.title asc";
	return {
		prompts: db.prepare(`
    select p.id, p.title, p.slug, p.model, p.price_cents as priceCents, p.featured, p.image, p.ratio,
      p.description, p.tags, p.sales, p.views, p.rating, p.created_at as createdAt,
      c.name as category, c.id as categoryId, cr.name as creator, cr.handle as creatorHandle,
      case when f.prompt_id is null then 0 else 1 end as favorite,
      case when ci.prompt_id is null then 0 else 1 end as inCart,
      round((p.sales * 1.35) + (p.rating * 28) + (p.views * .018) + case when p.featured=1 then 85 else 0 end - (p.price_cents / 900.0), 2) as rank_score
    from prompts p
    join categories c on c.id = p.category_id
    join creators cr on cr.id = p.creator_id
    left join favorites f on f.prompt_id = p.id and f.user_id = @userId
    left join cart_items ci on ci.prompt_id = p.id and ci.user_id = @userId
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${orderBy}
  `).all(params),
		counts: db.prepare(`
    select
      count(*) as total,
      sum(case when featured=1 then 1 else 0 end) as featured,
      sum(case when price_cents=0 then 1 else 0 end) as free,
      sum(case when price_cents>0 then 1 else 0 end) as paid
    from prompts
  `).get(),
		models: db.prepare("select model, count(*) as count from prompts group by model order by model").all(),
		categories: db.prepare("select id, name, color, (select count(*) from prompts p where p.category_id = categories.id) as count from categories order by name").all()
	};
}
function getPrompt(db, id) {
	return db.prepare(`
    select p.id, p.title, p.slug, p.model, p.price_cents as priceCents, p.featured, p.image, p.ratio, p.description,
      p.tags, p.sales, p.views, p.rating, p.created_at as createdAt, c.name as category, cr.name as creator,
      cr.handle as creatorHandle, cr.specialty as creatorSpecialty, cr.avatar as creatorAvatar,
      case when f.prompt_id is null then 0 else 1 end as favorite,
      case when ci.prompt_id is null then 0 else 1 end as inCart
    from prompts p
    join categories c on c.id = p.category_id
    join creators cr on cr.id = p.creator_id
    left join favorites f on f.prompt_id = p.id and f.user_id = ?
    left join cart_items ci on ci.prompt_id = p.id and ci.user_id = ?
    where p.id = ? or p.slug = ?
  `).get(demoUserId, demoUserId, id, id);
}
function toggleFavorite(db, promptId) {
	const existing = db.prepare("select 1 from favorites where user_id=? and prompt_id=?").get(demoUserId, promptId);
	if (existing) db.prepare("delete from favorites where user_id=? and prompt_id=?").run(demoUserId, promptId);
	else db.prepare("insert into favorites values (?, ?)").run(demoUserId, promptId);
	return {
		favorite: !existing,
		count: db.prepare("select count(*) as count from favorites where user_id=?").get(demoUserId)
	};
}
function addToCart(db, promptId) {
	db.prepare("insert into cart_items values (?, ?, 1) on conflict(user_id, prompt_id) do update set quantity=quantity+1").run(demoUserId, promptId);
	return getCart(db);
}
function removeFromCart(db, promptId) {
	db.prepare("delete from cart_items where user_id=? and prompt_id=?").run(demoUserId, promptId);
	return getCart(db);
}
function getCart(db) {
	return {
		items: db.prepare(`
    select p.id, p.title, p.model, p.price_cents as priceCents, p.image, ci.quantity, cr.name as creator,
      (p.price_cents * ci.quantity) as lineTotalCents
    from cart_items ci join prompts p on p.id=ci.prompt_id join creators cr on cr.id=p.creator_id
    where ci.user_id=? order by p.title
  `).all(demoUserId),
		totals: db.prepare(`
    select coalesce(sum(p.price_cents * ci.quantity),0) as subtotalCents,
      cast(round(coalesce(sum(p.price_cents * ci.quantity),0) * ?) as integer) as feeCents,
      coalesce(sum(p.price_cents * ci.quantity),0) + cast(round(coalesce(sum(p.price_cents * ci.quantity),0) * ?) as integer) as totalCents,
      count(*) as itemCount
    from cart_items ci join prompts p on p.id=ci.prompt_id where ci.user_id=?
  `).get(feeRate, feeRate, demoUserId)
	};
}
function checkout(db) {
	const cart = getCart(db);
	if (!cart.totals.itemCount) return {
		ok: false,
		orderId: null,
		cart
	};
	const orderId = `ord-${Date.now().toString(36)}`;
	const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
	db.prepare("insert into orders values (?, ?, ?, ?, ?, ?, ?)").run(orderId, demoUserId, cart.totals.subtotalCents, cart.totals.feeCents, cart.totals.totalCents, "paid", now);
	const insertItem = db.prepare("insert into order_items values (?, ?, ?)");
	const bumpSales = db.prepare("update prompts set sales=sales+? where id=?");
	for (const item of cart.items) {
		insertItem.run(orderId, item.id, item.priceCents);
		bumpSales.run(item.quantity, item.id);
	}
	db.prepare("delete from cart_items where user_id=?").run(demoUserId);
	return {
		ok: true,
		orderId,
		cart: getCart(db)
	};
}
function analytics(db) {
	return {
		summary: db.prepare(`
    select count(*) as orders, coalesce(sum(total_cents),0) as grossCents,
      cast(round(coalesce(avg(total_cents),0)) as integer) as averageOrderValueCents,
      round((select count(*) from orders where status='paid') * 100.0 / nullif((select sum(views) from prompts),0), 3) as conversionRate
    from orders where status='paid'
  `).get(),
		creatorRevenue: db.prepare(`
    select cr.name, cr.handle, coalesce(sum(oi.price_cents),0) as revenueCents, count(oi.prompt_id) as sales
    from creators cr left join prompts p on p.creator_id=cr.id left join order_items oi on oi.prompt_id=p.id
    group by cr.id order by revenueCents desc
  `).all(),
		categoryRevenue: db.prepare(`
    select c.name, coalesce(sum(oi.price_cents),0) as revenueCents, count(oi.prompt_id) as sales
    from categories c left join prompts p on p.category_id=c.id left join order_items oi on oi.prompt_id=p.id
    group by c.id order by revenueCents desc
  `).all(),
		dailySales: db.prepare(`
    select created_at as day, count(*) as orders, sum(total_cents) as totalCents
    from orders where status='paid' group by created_at order by created_at
  `).all()
	};
}
//#endregion
export { getCart as a, removeFromCart as c, creators as d, demoUserId as f, seedOrders as h, checkout as i, toggleFavorite as l, seedOrderItems as m, addToCart as n, getPrompt as o, prompts as p, analytics as r, listCatalog as s, CatalogInput as t, categories as u };
