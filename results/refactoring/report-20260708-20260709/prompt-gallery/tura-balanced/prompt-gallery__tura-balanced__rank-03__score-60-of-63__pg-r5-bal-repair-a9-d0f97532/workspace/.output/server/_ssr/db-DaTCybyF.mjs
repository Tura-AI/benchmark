import * as fs from "node:fs";
import * as path from "node:path";
//#region node_modules/.nitro/vite/services/ssr/assets/db-DaTCybyF.js
var seedDatabase = {
	creators: [
		{
			id: 1,
			name: "Atlas Studio",
			handle: "@atlas",
			studio: "Image systems"
		},
		{
			id: 2,
			name: "Field & Co.",
			handle: "@field",
			studio: "Brand prompts"
		},
		{
			id: 3,
			name: "Lumen",
			handle: "@lumen",
			studio: "Photo direction"
		},
		{
			id: 4,
			name: "Ops Guild",
			handle: "@opsguild",
			studio: "Workflow prompts"
		}
	],
	categories: [
		{
			id: 1,
			name: "Image"
		},
		{
			id: 2,
			name: "Photography"
		},
		{
			id: 3,
			name: "Design"
		},
		{
			id: 4,
			name: "Writing"
		},
		{
			id: 5,
			name: "Code"
		},
		{
			id: 6,
			name: "Marketing"
		},
		{
			id: 7,
			name: "Productivity"
		},
		{
			id: 8,
			name: "Research"
		}
	],
	prompts: [
		{
			id: 207,
			title: "Cinematic Still, 35mm",
			model: "Midjourney",
			categoryId: 1,
			creatorId: 1,
			price: 9,
			sold: 4700,
			rating: 5,
			aspect: "3/4",
			description: "Film-grade stills with lens language, grain, and lighting that reads as cinema.",
			image: "/media/prompts/pp207.svg",
			createdAt: "2026-06-11",
			featured: true
		},
		{
			id: 233,
			title: "Ink Wash Warrior",
			model: "Midjourney",
			categoryId: 1,
			creatorId: 1,
			price: 12,
			sold: 2100,
			rating: 4.9,
			aspect: "2/3",
			description: "Sumi-e meets splash ink: dramatic monochrome heroes with controlled negative space.",
			image: "/media/prompts/pp233.svg",
			createdAt: "2026-06-21",
			featured: true
		},
		{
			id: 174,
			title: "Editorial Photo Grade",
			model: "Flux",
			categoryId: 2,
			creatorId: 3,
			price: 11,
			sold: 1300,
			rating: 4.9,
			aspect: "3/4",
			description: "Magazine-style color grading with warm skin, deep shadow, and a quiet print look.",
			image: "/media/prompts/pp174.svg",
			createdAt: "2026-05-18",
			featured: false
		},
		{
			id: 301,
			title: "Magazine Cover Maker",
			model: "GPT-4o",
			categoryId: 3,
			creatorId: 2,
			price: 14,
			sold: 3300,
			rating: 4.8,
			aspect: "4/5",
			description: "Drop in a photo and receive a structured cover direction with hierarchy and trim notes.",
			image: "/media/prompts/pp301.svg",
			createdAt: "2026-07-02",
			featured: true
		},
		{
			id: 118,
			title: "Studio Portrait, Soft Light",
			model: "Flux",
			categoryId: 2,
			creatorId: 3,
			price: 10,
			sold: 1800,
			rating: 4.9,
			aspect: "4/5",
			description: "Clean beauty light with believable falloff for portraits that look shot, not rendered.",
			image: "/media/prompts/pp118.svg",
			createdAt: "2026-04-30",
			featured: true
		},
		{
			id: 198,
			title: "Logo Sketch, Mono-line",
			model: "Midjourney",
			categoryId: 3,
			creatorId: 2,
			price: 13,
			sold: 980,
			rating: 4.8,
			aspect: "1/1",
			description: "Single-weight line marks with real negative-space thinking and vector-ready directions.",
			image: "/media/prompts/pp198.svg",
			createdAt: "2026-06-02",
			featured: false
		},
		{
			id: 142,
			title: "The Cold-Email Closer",
			model: "GPT-4o",
			categoryId: 6,
			creatorId: 2,
			price: 12,
			sold: 2300,
			rating: 4.9,
			aspect: "4/3",
			description: "Cold emails that get replies with a tested four-line structure and subject variants.",
			image: "/media/prompts/pp142.svg",
			createdAt: "2026-05-07",
			featured: true
		},
		{
			id: 160,
			title: "Senior Code Reviewer",
			model: "Claude",
			categoryId: 5,
			creatorId: 4,
			price: 18,
			sold: 1100,
			rating: 4.8,
			aspect: "1/1",
			description: "Reviews your diff like a staff engineer: catches risk, suggests fixes, explains why.",
			image: "/media/prompts/pp160.svg",
			createdAt: "2026-05-13",
			featured: false
		},
		{
			id: 255,
			title: "Neon Street, Night",
			model: "Flux",
			categoryId: 2,
			creatorId: 3,
			price: 8,
			sold: 2600,
			rating: 4.7,
			aspect: "3/4",
			description: "Rain-slick neon with real reflections and grain for moody night photography prompts.",
			image: "/media/prompts/pp255.svg",
			createdAt: "2026-06-25",
			featured: true
		},
		{
			id: 189,
			title: "Brand Voice, Bottled",
			model: "Claude",
			categoryId: 6,
			creatorId: 2,
			price: 24,
			sold: 860,
			rating: 4.9,
			aspect: "4/3",
			description: "Feed three samples and get a reusable voice guide that writes in a precise tone.",
			image: "/media/prompts/pp189.svg",
			createdAt: "2026-05-26",
			featured: false
		},
		{
			id: 211,
			title: "Anime Key Visual",
			model: "Midjourney",
			categoryId: 1,
			creatorId: 1,
			price: 15,
			sold: 3900,
			rating: 5,
			aspect: "2/3",
			description: "Poster-grade key art with depth, disciplined lighting, and a single focal subject.",
			image: "/media/prompts/pp211.svg",
			createdAt: "2026-06-15",
			featured: true
		},
		{
			id: 31,
			title: "The Socratic Tutor",
			model: "GPT-4o",
			categoryId: 8,
			creatorId: 4,
			price: 0,
			sold: 9200,
			rating: 4.7,
			aspect: "5/4",
			description: "Leads learners with questions at the right difficulty instead of handing over answers.",
			image: "/media/prompts/pp31.svg",
			createdAt: "2026-03-19",
			featured: true
		},
		{
			id: 276,
			title: "Product Shot, White BG",
			model: "Flux",
			categoryId: 2,
			creatorId: 3,
			price: 9,
			sold: 1500,
			rating: 4.8,
			aspect: "1/1",
			description: "Clean e-commerce hero shots with soft contact shadow and drop-in product direction.",
			image: "/media/prompts/pp276.svg",
			createdAt: "2026-06-29",
			featured: false
		},
		{
			id: 212,
			title: "The Worldbuilder's Bible",
			model: "GPT-4o",
			categoryId: 4,
			creatorId: 1,
			price: 29,
			sold: 720,
			rating: 5,
			aspect: "4/5",
			description: "Builds a consistent fictional world with geography, factions, history, and continuity.",
			image: "/media/prompts/pp212.svg",
			createdAt: "2026-06-16",
			featured: false
		},
		{
			id: 248,
			title: "Vintage Film Poster",
			model: "Midjourney",
			categoryId: 3,
			creatorId: 1,
			price: 13,
			sold: 2200,
			rating: 4.9,
			aspect: "3/4",
			description: "Seventies grain, bold layout direction, and archive-like one-sheet poster logic.",
			image: "/media/prompts/pp248.svg",
			createdAt: "2026-06-23",
			featured: true
		},
		{
			id: 156,
			title: "Bug-to-Test Generator",
			model: "GPT-4o",
			categoryId: 5,
			creatorId: 4,
			price: 15,
			sold: 1900,
			rating: 4.8,
			aspect: "4/3",
			description: "Paste a bug report and get a failing test, candidate fix, and edge-case checklist.",
			image: "/media/prompts/pp156.svg",
			createdAt: "2026-05-11",
			featured: false
		},
		{
			id: 267,
			title: "Dreamy Bokeh Portrait",
			model: "Flux",
			categoryId: 2,
			creatorId: 3,
			price: 10,
			sold: 1700,
			rating: 4.8,
			aspect: "4/5",
			description: "Creamy backgrounds, golden warmth, and eyes in crisp focus for portrait systems.",
			image: "/media/prompts/pp267.svg",
			createdAt: "2026-06-27",
			featured: true
		},
		{
			id: 101,
			title: "Meeting to Memo",
			model: "Claude",
			categoryId: 7,
			creatorId: 4,
			price: 6,
			sold: 5100,
			rating: 4.7,
			aspect: "4/3",
			description: "Turns messy transcripts into decision memos with owners, dates, and next actions.",
			image: "/media/prompts/pp101.svg",
			createdAt: "2026-04-12",
			featured: true
		},
		{
			id: 290,
			title: "Concept Car, Studio",
			model: "Midjourney",
			categoryId: 1,
			creatorId: 1,
			price: 12,
			sold: 1400,
			rating: 4.8,
			aspect: "3/2",
			description: "Automotive design renders with believable studio reflections and sense of scale.",
			image: "/media/prompts/pp290.svg",
			createdAt: "2026-07-01",
			featured: false
		},
		{
			id: 77,
			title: "The Plot Doctor",
			model: "Claude",
			categoryId: 4,
			creatorId: 2,
			price: 16,
			sold: 1400,
			rating: 4.9,
			aspect: "1/1",
			description: "Diagnoses stalled stories and prescribes fixes for stakes, pacing, and scene intent.",
			image: "/media/prompts/pp77.svg",
			createdAt: "2026-04-03",
			featured: false
		},
		{
			id: 221,
			title: "Watercolor Cityscape",
			model: "Flux",
			categoryId: 1,
			creatorId: 1,
			price: 9,
			sold: 2e3,
			rating: 4.9,
			aspect: "3/4",
			description: "Loose luminous washes with confident linework, soft skies, and lively streets.",
			image: "/media/prompts/pp221.svg",
			createdAt: "2026-06-18",
			featured: true
		},
		{
			id: 63,
			title: "Inbox Zero Strategist",
			model: "Claude",
			categoryId: 7,
			creatorId: 4,
			price: 8,
			sold: 3400,
			rating: 4.6,
			aspect: "4/3",
			description: "Triages, drafts, and schedules a full inbox in one pass by weekly impact.",
			image: "/media/prompts/pp63.svg",
			createdAt: "2026-03-27",
			featured: true
		}
	],
	users: [{
		id: 1,
		name: "Demo buyer"
	}],
	cart: [{
		userId: 1,
		promptId: 142,
		quantity: 1
	}, {
		userId: 1,
		promptId: 31,
		quantity: 1
	}],
	favorites: [
		{
			userId: 1,
			promptId: 207
		},
		{
			userId: 1,
			promptId: 31
		},
		{
			userId: 1,
			promptId: 101
		}
	],
	orders: [
		{
			id: 1,
			userId: 1,
			createdAt: "2026-07-02",
			subtotal: 36,
			fee: 2.88,
			total: 38.88
		},
		{
			id: 2,
			userId: 1,
			createdAt: "2026-07-03",
			subtotal: 27,
			fee: 2.16,
			total: 29.16
		},
		{
			id: 3,
			userId: 1,
			createdAt: "2026-07-04",
			subtotal: 48,
			fee: 3.84,
			total: 51.84
		},
		{
			id: 4,
			userId: 1,
			createdAt: "2026-07-05",
			subtotal: 29,
			fee: 2.32,
			total: 31.32
		},
		{
			id: 5,
			userId: 1,
			createdAt: "2026-07-06",
			subtotal: 42,
			fee: 3.36,
			total: 45.36
		}
	],
	orderItems: [
		{
			orderId: 1,
			promptId: 207,
			price: 9,
			creatorId: 1,
			categoryId: 1
		},
		{
			orderId: 1,
			promptId: 301,
			price: 14,
			creatorId: 2,
			categoryId: 3
		},
		{
			orderId: 1,
			promptId: 248,
			price: 13,
			creatorId: 1,
			categoryId: 3
		},
		{
			orderId: 2,
			promptId: 118,
			price: 10,
			creatorId: 3,
			categoryId: 2
		},
		{
			orderId: 2,
			promptId: 101,
			price: 6,
			creatorId: 4,
			categoryId: 7
		},
		{
			orderId: 2,
			promptId: 174,
			price: 11,
			creatorId: 3,
			categoryId: 2
		},
		{
			orderId: 3,
			promptId: 189,
			price: 24,
			creatorId: 2,
			categoryId: 6
		},
		{
			orderId: 3,
			promptId: 160,
			price: 18,
			creatorId: 4,
			categoryId: 5
		},
		{
			orderId: 3,
			promptId: 101,
			price: 6,
			creatorId: 4,
			categoryId: 7
		},
		{
			orderId: 4,
			promptId: 212,
			price: 29,
			creatorId: 1,
			categoryId: 4
		},
		{
			orderId: 5,
			promptId: 142,
			price: 12,
			creatorId: 2,
			categoryId: 6
		},
		{
			orderId: 5,
			promptId: 211,
			price: 15,
			creatorId: 1,
			categoryId: 1
		},
		{
			orderId: 5,
			promptId: 290,
			price: 12,
			creatorId: 1,
			categoryId: 1
		},
		{
			orderId: 5,
			promptId: 31,
			price: 0,
			creatorId: 4,
			categoryId: 8
		}
	],
	visits: 188
};
var dataDir = path.join(process.cwd(), "data");
var dbPath = path.join(dataDir, "powerprompt.db.json");
var platformFeeRate = .08;
function cloneSeed() {
	return JSON.parse(JSON.stringify(seedDatabase));
}
function resetDatabase() {
	fs.mkdirSync(dataDir, { recursive: true });
	fs.writeFileSync(dbPath, JSON.stringify(cloneSeed(), null, 2));
}
function readDatabase() {
	if (!fs.existsSync(dbPath)) resetDatabase();
	const raw = fs.readFileSync(dbPath, "utf8");
	return JSON.parse(raw);
}
function writeDatabase(db) {
	fs.mkdirSync(dataDir, { recursive: true });
	fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}
function roundMoney(value) {
	return Math.round(value * 100) / 100;
}
function rankScore(prompt) {
	const recency = 100 / Math.max(1, (Date.now() - Date.parse(prompt.createdAt)) / 864e5);
	return roundMoney(prompt.sold * .68 + prompt.rating * 120 + recency + (prompt.featured ? 240 : 0));
}
function promptCards(db, userId = 1) {
	const favorites = new Set(db.favorites.filter((row) => row.userId === userId).map((row) => row.promptId));
	const cart = new Set(db.cart.filter((row) => row.userId === userId).map((row) => row.promptId));
	return db.prompts.map((prompt) => {
		const category = db.categories.find((item) => item.id === prompt.categoryId);
		const creator = db.creators.find((item) => item.id === prompt.creatorId);
		if (!category || !creator) throw new Error(`Prompt ${prompt.id} has broken seed relations`);
		return {
			...prompt,
			category: category.name,
			creator: creator.name,
			handle: creator.handle,
			isFavorite: favorites.has(prompt.id),
			inCart: cart.has(prompt.id),
			rankScore: rankScore(prompt)
		};
	});
}
function sortPrompts(rows, sort) {
	const sorted = [...rows];
	if (sort === "newest") sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
	if (sort === "popular") sorted.sort((a, b) => b.rating - a.rating || b.sold - a.sold);
	if (sort === "featured") sorted.sort((a, b) => b.rankScore - a.rankScore);
	return sorted;
}
function getCartSummary(userId = 1, db = readDatabase()) {
	const rows = promptCards(db, userId);
	const items = db.cart.filter((row) => row.userId === userId).map((row) => {
		const prompt = rows.find((item) => item.id === row.promptId);
		if (!prompt) throw new Error(`Cart prompt ${row.promptId} is missing`);
		return {
			...prompt,
			quantity: row.quantity,
			lineTotal: roundMoney(prompt.price * row.quantity)
		};
	});
	const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
	const fee = roundMoney(subtotal * platformFeeRate);
	return {
		items,
		count: items.reduce((sum, item) => sum + item.quantity, 0),
		subtotal,
		fee,
		total: roundMoney(subtotal + fee)
	};
}
function getStorefront(query = {}, userId = 1) {
	const db = readDatabase();
	const sort = query.sort ?? "featured";
	const term = (query.q ?? "").trim().toLowerCase();
	let rows = promptCards(db, userId);
	if (query.model && query.model !== "all") rows = rows.filter((prompt) => prompt.model === query.model);
	if (query.category && query.category !== "all") rows = rows.filter((prompt) => prompt.category === query.category);
	if (query.free) rows = rows.filter((prompt) => prompt.price === 0);
	if (query.favorites) rows = rows.filter((prompt) => prompt.isFavorite);
	if (term) rows = rows.filter((prompt) => `${prompt.title} ${prompt.model} ${prompt.category} ${prompt.description} ${prompt.creator}`.toLowerCase().includes(term));
	const all = promptCards(db, userId);
	const cart = getCartSummary(userId, db);
	return {
		prompts: sortPrompts(rows, sort),
		categories: db.categories,
		counts: {
			total: all.length,
			free: all.filter((prompt) => prompt.price === 0).length,
			paid: all.filter((prompt) => prompt.price > 0).length,
			featured: all.filter((prompt) => prompt.featured).length,
			favorites: all.filter((prompt) => prompt.isFavorite).length,
			cart: cart.count
		},
		active: {
			model: query.model ?? "all",
			category: query.category ?? "all",
			sort,
			q: query.q ?? "",
			favorites: Boolean(query.favorites)
		},
		cart
	};
}
function getPrompt(id, userId = 1) {
	const row = promptCards(readDatabase(), userId).find((prompt) => prompt.id === id);
	if (!row) throw new Error(`Prompt ${id} was not found`);
	return row;
}
function toggleFavorite(promptId, userId = 1) {
	const db = readDatabase();
	const exists = db.favorites.some((row) => row.userId === userId && row.promptId === promptId);
	db.favorites = exists ? db.favorites.filter((row) => !(row.userId === userId && row.promptId === promptId)) : [...db.favorites, {
		userId,
		promptId
	}];
	writeDatabase(db);
	return {
		favorited: !exists,
		counts: getStorefront({}, userId).counts
	};
}
function addToCart(promptId, userId = 1) {
	const db = readDatabase();
	if (!db.prompts.some((prompt) => prompt.id === promptId)) throw new Error(`Prompt ${promptId} was not found`);
	const existing = db.cart.find((row) => row.userId === userId && row.promptId === promptId);
	if (existing) existing.quantity += 1;
	else db.cart.push({
		userId,
		promptId,
		quantity: 1
	});
	writeDatabase(db);
	return getCartSummary(userId);
}
function removeFromCart(promptId, userId = 1) {
	const db = readDatabase();
	db.cart = db.cart.filter((row) => !(row.userId === userId && row.promptId === promptId));
	writeDatabase(db);
	return getCartSummary(userId);
}
function checkout(userId = 1) {
	const db = readDatabase();
	const summary = getCartSummary(userId, db);
	if (!summary.items.length) throw new Error("Cart is empty");
	const id = Math.max(0, ...db.orders.map((order) => order.id)) + 1;
	const createdAt = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
	db.orders.push({
		id,
		userId,
		createdAt,
		subtotal: summary.subtotal,
		fee: summary.fee,
		total: summary.total
	});
	for (const item of summary.items) db.orderItems.push({
		orderId: id,
		promptId: item.id,
		price: item.price,
		creatorId: item.creatorId,
		categoryId: item.categoryId
	});
	db.cart = db.cart.filter((row) => row.userId !== userId);
	writeDatabase(db);
	return {
		orderId: id,
		...summary
	};
}
function getAnalytics() {
	const db = readDatabase();
	const totalRevenue = roundMoney(db.orders.reduce((sum, order) => sum + order.total, 0));
	const creatorRevenue = db.creators.map((creator) => {
		const items = db.orderItems.filter((item) => item.creatorId === creator.id);
		const prompts = db.prompts.filter((prompt) => prompt.creatorId === creator.id);
		const views = prompts.reduce((sum, prompt) => sum + prompt.sold, 0);
		return {
			creatorId: creator.id,
			creator: creator.name,
			prompts: prompts.length,
			units: items.length,
			revenue: roundMoney(items.reduce((sum, item) => sum + item.price, 0)),
			conversionRate: roundMoney(items.length / Math.max(1, views) * 100)
		};
	}).sort((a, b) => b.revenue - a.revenue);
	const categoryRevenue = db.categories.map((category) => {
		const items = db.orderItems.filter((item) => item.categoryId === category.id);
		return {
			category: category.name,
			units: items.length,
			revenue: roundMoney(items.reduce((sum, item) => sum + item.price, 0))
		};
	}).filter((row) => row.units > 0).sort((a, b) => b.revenue - a.revenue);
	const dailySales = [...new Set(db.orders.map((order) => order.createdAt))].sort().map((date) => {
		const orders = db.orders.filter((order) => order.createdAt === date);
		return {
			date,
			orders: orders.length,
			revenue: roundMoney(orders.reduce((sum, order) => sum + order.total, 0))
		};
	});
	return {
		creatorRevenue,
		categoryRevenue,
		dailySales,
		trend: dailySales.map((row, index) => {
			const previous = dailySales[index - 1]?.revenue ?? row.revenue;
			return {
				date: row.date,
				revenue: row.revenue,
				change: roundMoney(row.revenue - previous)
			};
		}),
		averageOrderValue: roundMoney(totalRevenue / Math.max(1, db.orders.length)),
		conversionRate: roundMoney(db.orders.length / Math.max(1, db.visits) * 100),
		totalRevenue,
		orderCount: db.orders.length
	};
}
//#endregion
export { getPrompt as a, toggleFavorite as c, getCartSummary as i, checkout as n, getStorefront as o, getAnalytics as r, removeFromCart as s, addToCart as t };
