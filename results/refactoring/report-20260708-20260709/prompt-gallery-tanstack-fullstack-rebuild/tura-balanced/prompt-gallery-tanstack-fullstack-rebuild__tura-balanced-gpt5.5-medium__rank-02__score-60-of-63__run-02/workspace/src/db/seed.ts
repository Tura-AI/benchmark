export const USER_ID = 'user_demo'

export const creators = [
  { id: 'creator_atlas', name: 'Atlas Studio', handle: '@atlas', tier: 'studio' },
  { id: 'creator_field', name: 'Field & Co.', handle: '@field', tier: 'agency' },
  { id: 'creator_lumen', name: 'Lumen', handle: '@lumen', tier: 'pro' },
  { id: 'creator_indie', name: 'Independent Guild', handle: '@guild', tier: 'collective' },
] as const

export const categories = [
  'Image',
  'Photography',
  'Design',
  'Writing',
  'Code',
  'Marketing',
  'Productivity',
  'Research',
] as const

export const prompts = [
  { id: 207, title: 'Cinematic Still, 35mm', model: 'Midjourney', category: 'Image', price: 9, sold: 4700, rating: 5.0, creator: 'creator_atlas', ar: '3/4', featured: 1, created: '2026-07-01', desc: 'Film-grade stills with real lens language, focal length, grain, and lighting that reads as cinema.' },
  { id: 233, title: 'Ink Wash Warrior', model: 'Midjourney', category: 'Image', price: 12, sold: 2100, rating: 4.9, creator: 'creator_indie', ar: '2/3', featured: 0, created: '2026-07-02', desc: 'Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space.' },
  { id: 174, title: 'Editorial Photo Grade', model: 'Flux', category: 'Photography', price: 11, sold: 1300, rating: 4.9, creator: 'creator_lumen', ar: '3/4', featured: 1, created: '2026-06-25', desc: 'Magazine-style color grading with warm skin, deep shadow, and a quiet print look.' },
  { id: 301, title: 'Magazine Cover Maker', model: 'GPT-4o', category: 'Design', price: 14, sold: 3300, rating: 4.8, creator: 'creator_field', ar: '4/5', featured: 1, created: '2026-07-07', desc: 'Drop in a photo, get a full cover: masthead, cover lines, barcode, and layout direction.' },
  { id: 118, title: 'Studio Portrait, Soft Light', model: 'Flux', category: 'Photography', price: 10, sold: 1800, rating: 4.9, creator: 'creator_lumen', ar: '4/5', featured: 0, created: '2026-06-20', desc: 'Clean beauty light with believable falloff. Looks shot, not rendered.' },
  { id: 198, title: 'Logo Sketch, Mono-line', model: 'Midjourney', category: 'Design', price: 13, sold: 980, rating: 4.8, creator: 'creator_field', ar: '1/1', featured: 0, created: '2026-06-28', desc: 'Single-weight line marks with real negative-space thinking and vector-ready directions.' },
  { id: 142, title: 'The Cold-Email Closer', model: 'GPT-4o', category: 'Marketing', price: 12, sold: 2300, rating: 4.9, creator: 'creator_indie', ar: '4/3', featured: 1, created: '2026-06-26', desc: 'Cold emails that get replies. A tested four-line structure with subject variants baked in.' },
  { id: 160, title: 'Senior Code Reviewer', model: 'Claude', category: 'Code', price: 18, sold: 1100, rating: 4.8, creator: 'creator_indie', ar: '1/1', featured: 0, created: '2026-06-24', desc: 'Reviews your diff like a staff engineer: catches risk, suggests fixes, explains the why.' },
  { id: 255, title: 'Neon Street, Night', model: 'Flux', category: 'Photography', price: 8, sold: 2600, rating: 4.7, creator: 'creator_atlas', ar: '3/4', featured: 0, created: '2026-07-04', desc: 'Rain-slick neon with real reflections and grain. A cinematic night prompt with restraint.' },
  { id: 189, title: 'Brand Voice, Bottled', model: 'Claude', category: 'Marketing', price: 24, sold: 860, rating: 4.9, creator: 'creator_field', ar: '4/3', featured: 1, created: '2026-06-22', desc: 'Feed it three samples; get a reusable voice guide that writes in your exact tone.' },
  { id: 211, title: 'Anime Key Visual', model: 'Midjourney', category: 'Image', price: 15, sold: 3900, rating: 5.0, creator: 'creator_atlas', ar: '2/3', featured: 1, created: '2026-07-03', desc: 'Poster-grade key art with depth, rim light, and a clear focal subject.' },
  { id: 31, title: 'The Socratic Tutor', model: 'GPT-4o', category: 'Research', price: 0, sold: 9200, rating: 4.7, creator: 'creator_indie', ar: '5/4', featured: 1, created: '2026-05-18', desc: 'Never hands you the answer; leads you there with questions at the right difficulty.' },
  { id: 276, title: 'Product Shot, White BG', model: 'Flux', category: 'Photography', price: 9, sold: 1500, rating: 4.8, creator: 'creator_lumen', ar: '1/1', featured: 0, created: '2026-07-05', desc: 'Clean e-commerce hero shots with soft contact shadow, ready for storefront work.' },
  { id: 212, title: "The Worldbuilder's Bible", model: 'GPT-4o', category: 'Writing', price: 29, sold: 720, rating: 5.0, creator: 'creator_indie', ar: '4/5', featured: 0, created: '2026-07-03', desc: 'Builds a consistent fictional world: geography, factions, history, and continuity.' },
  { id: 248, title: 'Vintage Film Poster', model: 'Midjourney', category: 'Design', price: 13, sold: 2200, rating: 4.9, creator: 'creator_atlas', ar: '3/4', featured: 0, created: '2026-07-03', desc: '70s grain, bold type, halftone, and one-sheet framing pulled from archive language.' },
  { id: 156, title: 'Bug-to-Test Generator', model: 'GPT-4o', category: 'Code', price: 15, sold: 1900, rating: 4.8, creator: 'creator_indie', ar: '4/3', featured: 0, created: '2026-06-27', desc: 'Paste a bug report, get a failing test that reproduces it plus the fix and edge cases.' },
  { id: 267, title: 'Dreamy Bokeh Portrait', model: 'Flux', category: 'Photography', price: 10, sold: 1700, rating: 4.8, creator: 'creator_lumen', ar: '4/5', featured: 0, created: '2026-07-04', desc: 'Creamy backgrounds, golden-hour warmth, and eyes in razor focus.' },
  { id: 101, title: 'Meeting to Memo', model: 'Claude', category: 'Productivity', price: 6, sold: 5100, rating: 4.7, creator: 'creator_indie', ar: '4/3', featured: 1, created: '2026-05-22', desc: 'Turns a messy transcript into a crisp decision memo with owners, dates, and decisions.' },
  { id: 290, title: 'Concept Car, Studio', model: 'Midjourney', category: 'Image', price: 12, sold: 1400, rating: 4.8, creator: 'creator_atlas', ar: '3/2', featured: 0, created: '2026-07-06', desc: 'Automotive design renders with believable studio reflections and a real sense of scale.' },
  { id: 77, title: 'The Plot Doctor', model: 'Claude', category: 'Writing', price: 16, sold: 1400, rating: 4.9, creator: 'creator_indie', ar: '1/1', featured: 0, created: '2026-05-20', desc: 'Diagnoses why your story stalls and prescribes the fix: stakes, pacing, and scene work.' },
  { id: 221, title: 'Watercolor Cityscape', model: 'Flux', category: 'Image', price: 9, sold: 2000, rating: 4.9, creator: 'creator_lumen', ar: '3/4', featured: 0, created: '2026-07-01', desc: 'Loose, luminous washes with confident linework, soft skies, and busy streets.' },
  { id: 63, title: 'Inbox Zero Strategist', model: 'Claude', category: 'Productivity', price: 8, sold: 3400, rating: 4.6, creator: 'creator_indie', ar: '4/3', featured: 0, created: '2026-05-19', desc: 'Triage, draft, and schedule a full inbox in one pass, sorted by what moves your week.' },
] as const

export const orders = [
  { id: 1, user: USER_ID, promptId: 301, qty: 1, total: 14, day: '2026-07-01' },
  { id: 2, user: USER_ID, promptId: 207, qty: 2, total: 18, day: '2026-07-02' },
  { id: 3, user: 'user_creator', promptId: 31, qty: 1, total: 0, day: '2026-07-03' },
  { id: 4, user: 'user_creator', promptId: 211, qty: 1, total: 15, day: '2026-07-04' },
  { id: 5, user: USER_ID, promptId: 189, qty: 1, total: 24, day: '2026-07-05' },
  { id: 6, user: 'user_research', promptId: 101, qty: 3, total: 18, day: '2026-07-06' },
] as const

export const initialFavorites = [31, 207, 301]
export const initialCart = [142, 276]
