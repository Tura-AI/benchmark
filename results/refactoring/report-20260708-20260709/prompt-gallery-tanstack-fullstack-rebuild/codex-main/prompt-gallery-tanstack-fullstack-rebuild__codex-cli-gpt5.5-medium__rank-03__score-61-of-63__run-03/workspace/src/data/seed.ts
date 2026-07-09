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

export const creators = [
  { name: 'Atlas Studio', handle: '@atlas', avatar: 'AS' },
  { name: 'Lumen', handle: '@lumen', avatar: 'LU' },
  { name: 'Field & Co.', handle: '@field', avatar: 'FC' },
  { name: 'Marta Vey', handle: '@marta', avatar: 'MV' },
  { name: 'Sumi Lab', handle: '@sumi', avatar: 'SL' },
  { name: 'N. Sorensen', handle: '@nsorensen', avatar: 'NS' },
  { name: 'Studio Ko', handle: '@ko', avatar: 'KO' },
  { name: 'D. Okonkwo', handle: '@dokonkwo', avatar: 'DO' },
  { name: 'Kuro', handle: '@kuro', avatar: 'KU' },
  { name: 'Sakuga', handle: '@sakuga', avatar: 'SA' },
  { name: 'J. Halloran', handle: '@halloran', avatar: 'JH' },
  { name: 'E. Castellanos', handle: '@ecast', avatar: 'EC' },
  { name: 'Reel', handle: '@reel', avatar: 'RE' },
  { name: 'R. Mehta', handle: '@rmehta', avatar: 'RM' },
  { name: 'Ops Guild', handle: '@opsguild', avatar: 'OG' },
  { name: 'Forme', handle: '@forme', avatar: 'FO' },
  { name: 'H. Mbeki', handle: '@hmbeki', avatar: 'HM' },
  { name: 'Aquarelle', handle: '@aquarelle', avatar: 'AQ' },
  { name: 'Lina P.', handle: '@linap', avatar: 'LP' },
]

export const prompts = [
  { id: 207, title: 'Cinematic Still, 35mm', model: 'Midjourney', category: 'Image', price: 9, sold: 4700, rating: 5, creator: 'Atlas Studio', aspect: '3/4', featured: 1, date: '2026-06-21', desc: 'Film-grade stills with real lens language, focal length, grain, and lighting that reads as cinema.' },
  { id: 233, title: 'Ink Wash Warrior', model: 'Midjourney', category: 'Image', price: 12, sold: 2100, rating: 4.9, creator: 'Sumi Lab', aspect: '2/3', featured: 1, date: '2026-06-30', desc: 'Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space.' },
  { id: 174, title: 'Editorial Photo Grade', model: 'Flux', category: 'Photography', price: 11, sold: 1300, rating: 4.9, creator: 'N. Sorensen', aspect: '3/4', featured: 0, date: '2026-06-13', desc: 'Magazine-style color grading. Warm skin, deep shadow, that quiet print look without garish presets.' },
  { id: 301, title: 'Magazine Cover Maker', model: 'GPT-4o', category: 'Design', price: 14, sold: 3300, rating: 4.8, creator: 'Field & Co.', aspect: '4/5', featured: 1, date: '2026-07-02', desc: 'Drop in a photo, get a full cover with masthead, cover lines, barcode, and production notes.' },
  { id: 118, title: 'Studio Portrait, Soft Light', model: 'Flux', category: 'Photography', price: 10, sold: 1800, rating: 4.9, creator: 'Lumen', aspect: '4/5', featured: 1, date: '2026-06-06', desc: 'Clean beauty light with a believable falloff. Looks shot, not rendered.' },
  { id: 198, title: 'Logo Sketch, Mono-line', model: 'Midjourney', category: 'Design', price: 13, sold: 980, rating: 4.8, creator: 'Studio Ko', aspect: '1/1', featured: 0, date: '2026-06-18', desc: 'Single-weight line marks with real negative-space thinking. Vector-ready directions, fast.' },
  { id: 142, title: 'The Cold-Email Closer', model: 'GPT-4o', category: 'Marketing', price: 12, sold: 2300, rating: 4.9, creator: 'Marta Vey', aspect: '4/3', featured: 1, date: '2026-06-10', desc: 'Cold emails that actually get replies. A tested four-line structure with subject-line variants baked in.' },
  { id: 160, title: 'Senior Code Reviewer', model: 'Claude', category: 'Code', price: 18, sold: 1100, rating: 4.8, creator: 'D. Okonkwo', aspect: '1/1', featured: 0, date: '2026-06-12', desc: 'Reviews your diff like a staff engineer, catches risk, suggests fixes, and explains the why.' },
  { id: 255, title: 'Neon Street, Night', model: 'Flux', category: 'Photography', price: 8, sold: 2600, rating: 4.7, creator: 'Kuro', aspect: '3/4', featured: 1, date: '2026-07-01', desc: 'Rain-slick neon with real reflections and grain. That cyberpunk-on-a-budget look, nailed.' },
  { id: 189, title: 'Brand Voice, Bottled', model: 'Claude', category: 'Marketing', price: 24, sold: 860, rating: 4.9, creator: 'Field & Co.', aspect: '4/3', featured: 0, date: '2026-06-15', desc: 'Feed it three samples; get a reusable voice guide that writes anything in your exact tone.' },
  { id: 211, title: 'Anime Key Visual', model: 'Midjourney', category: 'Image', price: 15, sold: 3900, rating: 5, creator: 'Sakuga', aspect: '2/3', featured: 1, date: '2026-06-24', desc: 'Poster-grade key art with depth, rim light, and a real focal subject. Print at A2.' },
  { id: 31, title: 'The Socratic Tutor', model: 'GPT-4o', category: 'Research', price: 0, sold: 9200, rating: 4.7, creator: 'J. Halloran', aspect: '5/4', featured: 1, date: '2026-05-14', desc: 'Never hands you the answer. Leads you there with questions at exactly the right difficulty.' },
  { id: 276, title: 'Product Shot, White BG', model: 'Flux', category: 'Photography', price: 9, sold: 1500, rating: 4.8, creator: 'Lumen', aspect: '1/1', featured: 0, date: '2026-07-02', desc: 'Clean e-commerce hero shots with soft contact shadow. Drop-in ready for any storefront.' },
  { id: 212, title: "The Worldbuilder's Bible", model: 'GPT-4o', category: 'Writing', price: 29, sold: 720, rating: 5, creator: 'E. Castellanos', aspect: '4/5', featured: 0, date: '2026-06-25', desc: 'Builds a consistent fictional world: geography, factions, history, and continuity rules.' },
  { id: 248, title: 'Vintage Film Poster', model: 'Midjourney', category: 'Design', price: 13, sold: 2200, rating: 4.9, creator: 'Reel', aspect: '3/4', featured: 1, date: '2026-06-30', desc: '70s grain, bold type, halftone. One-sheets that look pulled from an archive.' },
  { id: 156, title: 'Bug-to-Test Generator', model: 'GPT-4o', category: 'Code', price: 15, sold: 1900, rating: 4.8, creator: 'R. Mehta', aspect: '4/3', featured: 0, date: '2026-06-11', desc: 'Paste a bug report, get a failing test that reproduces it plus the fix and edge cases.' },
  { id: 267, title: 'Dreamy Bokeh Portrait', model: 'Flux', category: 'Photography', price: 10, sold: 1700, rating: 4.8, creator: 'Lumen', aspect: '4/5', featured: 0, date: '2026-07-01', desc: 'Creamy backgrounds, golden-hour warmth, eyes in razor focus. Pure mood.' },
  { id: 101, title: 'Meeting to Memo', model: 'Claude', category: 'Productivity', price: 6, sold: 5100, rating: 4.7, creator: 'Ops Guild', aspect: '4/3', featured: 1, date: '2026-05-29', desc: 'Turns a messy transcript into a crisp decision memo: owners, dates, and the one thing that matters.' },
  { id: 290, title: 'Concept Car, Studio', model: 'Midjourney', category: 'Image', price: 12, sold: 1400, rating: 4.8, creator: 'Forme', aspect: '3/2', featured: 0, date: '2026-07-01', desc: 'Automotive design renders with believable studio reflections and a real sense of scale.' },
  { id: 77, title: 'The Plot Doctor', model: 'Claude', category: 'Writing', price: 16, sold: 1400, rating: 4.9, creator: 'H. Mbeki', aspect: '1/1', featured: 0, date: '2026-05-22', desc: 'Diagnoses why your story stalls and prescribes the fix: stakes, pacing, and the scene you are dodging.' },
  { id: 221, title: 'Watercolor Cityscape', model: 'Flux', category: 'Image', price: 9, sold: 2000, rating: 4.9, creator: 'Aquarelle', aspect: '3/4', featured: 0, date: '2026-06-27', desc: 'Loose, luminous washes with confident linework. Soft skies, busy streets.' },
  { id: 63, title: 'Inbox Zero Strategist', model: 'Claude', category: 'Productivity', price: 8, sold: 3400, rating: 4.6, creator: 'Lina P.', aspect: '4/3', featured: 1, date: '2026-05-20', desc: 'Triage, draft, and schedule a full inbox in one pass, sorted by what moves your week.' },
]

export const users = [{ id: 1, name: 'Demo Buyer', email: 'buyer@powerprompt.local' }]

export const seedFavorites = [207, 301, 31, 101]
export const seedCart = [142, 301, 118]

export const orderSeeds = [
  { userId: 1, promptIds: [207, 142, 301], createdAt: '2026-07-01T10:15:00Z', status: 'paid' },
  { userId: 1, promptIds: [31, 101], createdAt: '2026-07-02T12:20:00Z', status: 'paid' },
  { userId: 1, promptIds: [211, 255, 248], createdAt: '2026-07-03T16:40:00Z', status: 'paid' },
  { userId: 1, promptIds: [189, 160], createdAt: '2026-07-04T08:05:00Z', status: 'paid' },
  { userId: 1, promptIds: [212, 156], createdAt: '2026-07-05T19:35:00Z', status: 'paid' },
  { userId: 1, promptIds: [276, 267, 118], createdAt: '2026-07-06T11:10:00Z', status: 'paid' },
]
