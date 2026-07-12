//#region src/data/seed.ts
var userId = "user_demo";
var creators = [
	{
		id: "creator_atlas",
		name: "Atlas Studio",
		handle: "@atlas",
		payoutRate: .85
	},
	{
		id: "creator_lumen",
		name: "Lumen",
		handle: "@lumen",
		payoutRate: .85
	},
	{
		id: "creator_field",
		name: "Field & Co.",
		handle: "@fieldco",
		payoutRate: .85
	},
	{
		id: "creator_sakuga",
		name: "Sakuga",
		handle: "@sakuga",
		payoutRate: .85
	}
];
var categories = [
	"Image",
	"Photography",
	"Design",
	"Writing",
	"Code",
	"Marketing",
	"Productivity",
	"Research"
];
var prompts = [
	{
		id: 207,
		title: "Cinematic Still, 35mm",
		model: "Midjourney",
		category: "Image",
		price: 9,
		sold: 4700,
		rating: 5,
		creatorId: "creator_atlas",
		aspect: "3/4",
		featured: 1,
		createdAt: "2026-06-26",
		desc: "Film-grade stills with real lens language, focal length, grain, and lighting that reads as cinema."
	},
	{
		id: 233,
		title: "Ink Wash Warrior",
		model: "Midjourney",
		category: "Image",
		price: 12,
		sold: 2100,
		rating: 4.9,
		creatorId: "creator_sakuga",
		aspect: "2/3",
		featured: 1,
		createdAt: "2026-06-30",
		desc: "Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space."
	},
	{
		id: 174,
		title: "Editorial Photo Grade",
		model: "Flux",
		category: "Photography",
		price: 11,
		sold: 1300,
		rating: 4.9,
		creatorId: "creator_lumen",
		aspect: "3/4",
		featured: 0,
		createdAt: "2026-05-23",
		desc: "Magazine-style color grading. Warm skin, deep shadow, and a quiet print look."
	},
	{
		id: 301,
		title: "Magazine Cover Maker",
		model: "GPT-4o",
		category: "Design",
		price: 14,
		sold: 3300,
		rating: 4.8,
		creatorId: "creator_field",
		aspect: "4/5",
		featured: 1,
		createdAt: "2026-07-03",
		desc: "Drop in a photo, get a full cover system with masthead, cover lines, barcode, and layout notes."
	},
	{
		id: 118,
		title: "Studio Portrait, Soft Light",
		model: "Flux",
		category: "Photography",
		price: 10,
		sold: 1800,
		rating: 4.9,
		creatorId: "creator_lumen",
		aspect: "4/5",
		featured: 1,
		createdAt: "2026-04-15",
		desc: "Clean beauty light with believable falloff. Looks shot, not rendered."
	},
	{
		id: 198,
		title: "Logo Sketch, Mono-line",
		model: "Midjourney",
		category: "Design",
		price: 13,
		sold: 980,
		rating: 4.8,
		creatorId: "creator_atlas",
		aspect: "1/1",
		featured: 0,
		createdAt: "2026-06-18",
		desc: "Single-weight line marks with real negative-space thinking and vector-ready directions."
	},
	{
		id: 142,
		title: "The Cold-Email Closer",
		model: "GPT-4o",
		category: "Marketing",
		price: 12,
		sold: 2300,
		rating: 4.9,
		creatorId: "creator_field",
		aspect: "4/3",
		featured: 1,
		createdAt: "2026-05-02",
		desc: "Cold emails that get replies. A tested four-line structure with subject-line variants baked in."
	},
	{
		id: 160,
		title: "Senior Code Reviewer",
		model: "Claude",
		category: "Code",
		price: 18,
		sold: 1100,
		rating: 4.8,
		creatorId: "creator_atlas",
		aspect: "1/1",
		featured: 0,
		createdAt: "2026-05-10",
		desc: "Reviews your diff like a staff engineer: catches risk, suggests fixes, explains the why."
	},
	{
		id: 255,
		title: "Neon Street, Night",
		model: "Flux",
		category: "Photography",
		price: 8,
		sold: 2600,
		rating: 4.7,
		creatorId: "creator_lumen",
		aspect: "3/4",
		featured: 0,
		createdAt: "2026-07-01",
		desc: "Rain-slick neon with real reflections and grain. Night photography mood, nailed."
	},
	{
		id: 189,
		title: "Brand Voice, Bottled",
		model: "Claude",
		category: "Marketing",
		price: 24,
		sold: 860,
		rating: 4.9,
		creatorId: "creator_field",
		aspect: "4/3",
		featured: 1,
		createdAt: "2026-06-01",
		desc: "Feed it three samples; get a reusable voice guide that writes anything in your exact tone."
	},
	{
		id: 211,
		title: "Anime Key Visual",
		model: "Midjourney",
		category: "Image",
		price: 15,
		sold: 3900,
		rating: 5,
		creatorId: "creator_sakuga",
		aspect: "2/3",
		featured: 1,
		createdAt: "2026-06-27",
		desc: "Poster-grade key art with depth, rim light, and a real focal subject. Print at A2."
	},
	{
		id: 31,
		title: "The Socratic Tutor",
		model: "GPT-4o",
		category: "Research",
		price: 0,
		sold: 9200,
		rating: 4.7,
		creatorId: "creator_atlas",
		aspect: "5/4",
		featured: 1,
		createdAt: "2026-02-01",
		desc: "Never hands you the answer; leads you there with questions at exactly the right difficulty."
	},
	{
		id: 276,
		title: "Product Shot, White BG",
		model: "Flux",
		category: "Photography",
		price: 9,
		sold: 1500,
		rating: 4.8,
		creatorId: "creator_lumen",
		aspect: "1/1",
		featured: 0,
		createdAt: "2026-07-02",
		desc: "Clean ecommerce hero shots with soft contact shadow. Drop-in ready for any storefront."
	},
	{
		id: 212,
		title: "The Worldbuilder's Bible",
		model: "GPT-4o",
		category: "Writing",
		price: 29,
		sold: 720,
		rating: 5,
		creatorId: "creator_sakuga",
		aspect: "4/5",
		featured: 0,
		createdAt: "2026-06-28",
		desc: "Builds a consistent fictional world: geography, factions, history, and continuity."
	},
	{
		id: 248,
		title: "Vintage Film Poster",
		model: "Midjourney",
		category: "Design",
		price: 13,
		sold: 2200,
		rating: 4.9,
		creatorId: "creator_field",
		aspect: "3/4",
		featured: 1,
		createdAt: "2026-06-29",
		desc: "70s grain, bold type direction, and halftone one-sheets that look pulled from an archive."
	},
	{
		id: 156,
		title: "Bug-to-Test Generator",
		model: "GPT-4o",
		category: "Code",
		price: 15,
		sold: 1900,
		rating: 4.8,
		creatorId: "creator_atlas",
		aspect: "4/3",
		featured: 0,
		createdAt: "2026-05-07",
		desc: "Paste a bug report, get a failing test that reproduces it plus the fix and edge cases."
	},
	{
		id: 267,
		title: "Dreamy Bokeh Portrait",
		model: "Flux",
		category: "Photography",
		price: 10,
		sold: 1700,
		rating: 4.8,
		creatorId: "creator_lumen",
		aspect: "4/5",
		featured: 0,
		createdAt: "2026-07-01",
		desc: "Creamy backgrounds, golden-hour warmth, eyes in razor focus. Pure mood."
	},
	{
		id: 101,
		title: "Meeting to Memo",
		model: "Claude",
		category: "Productivity",
		price: 6,
		sold: 5100,
		rating: 4.7,
		creatorId: "creator_field",
		aspect: "4/3",
		featured: 1,
		createdAt: "2026-03-15",
		desc: "Turns a messy transcript into a crisp decision memo: owners, dates, the one thing that matters."
	},
	{
		id: 290,
		title: "Concept Car, Studio",
		model: "Midjourney",
		category: "Image",
		price: 12,
		sold: 1400,
		rating: 4.8,
		creatorId: "creator_atlas",
		aspect: "3/2",
		featured: 0,
		createdAt: "2026-07-03",
		desc: "Automotive design renders with believable studio reflections and a real sense of scale."
	},
	{
		id: 77,
		title: "The Plot Doctor",
		model: "Claude",
		category: "Writing",
		price: 16,
		sold: 1400,
		rating: 4.9,
		creatorId: "creator_sakuga",
		aspect: "1/1",
		featured: 0,
		createdAt: "2026-03-01",
		desc: "Diagnoses why your story stalls and prescribes the fix: stakes, pacing, the scene you're dodging."
	},
	{
		id: 221,
		title: "Watercolor Cityscape",
		model: "Flux",
		category: "Image",
		price: 9,
		sold: 2e3,
		rating: 4.9,
		creatorId: "creator_sakuga",
		aspect: "3/4",
		featured: 0,
		createdAt: "2026-06-29",
		desc: "Loose, luminous washes with confident linework. Soft skies, busy streets."
	},
	{
		id: 63,
		title: "Inbox Zero Strategist",
		model: "Claude",
		category: "Productivity",
		price: 8,
		sold: 3400,
		rating: 4.6,
		creatorId: "creator_field",
		aspect: "4/3",
		featured: 0,
		createdAt: "2026-02-20",
		desc: "Triage, draft, and schedule a full inbox in one pass, sorted by what moves your week."
	}
];
var orderRows = [
	{
		id: "ord_1001",
		userId,
		createdAt: "2026-07-01",
		subtotal: 46,
		fee: 4.6,
		total: 50.6
	},
	{
		id: "ord_1002",
		userId,
		createdAt: "2026-07-02",
		subtotal: 33,
		fee: 3.3,
		total: 36.3
	},
	{
		id: "ord_1003",
		userId,
		createdAt: "2026-07-03",
		subtotal: 53,
		fee: 5.3,
		total: 58.3
	}
];
var orderItems = [
	{
		orderId: "ord_1001",
		promptId: 207,
		quantity: 2,
		price: 9
	},
	{
		orderId: "ord_1001",
		promptId: 142,
		quantity: 1,
		price: 12
	},
	{
		orderId: "ord_1001",
		promptId: 248,
		quantity: 1,
		price: 13
	},
	{
		orderId: "ord_1002",
		promptId: 118,
		quantity: 1,
		price: 10
	},
	{
		orderId: "ord_1002",
		promptId: 101,
		quantity: 2,
		price: 6
	},
	{
		orderId: "ord_1002",
		promptId: 276,
		quantity: 1,
		price: 9
	},
	{
		orderId: "ord_1003",
		promptId: 301,
		quantity: 1,
		price: 14
	},
	{
		orderId: "ord_1003",
		promptId: 211,
		quantity: 2,
		price: 15
	},
	{
		orderId: "ord_1003",
		promptId: 189,
		quantity: 1,
		price: 24
	}
];
var favorites = [
	207,
	31,
	301
];
var cart = [142, 207];
//#endregion
export { orderItems as a, userId as c, favorites as i, categories as n, orderRows as o, creators as r, prompts as s, cart as t };
