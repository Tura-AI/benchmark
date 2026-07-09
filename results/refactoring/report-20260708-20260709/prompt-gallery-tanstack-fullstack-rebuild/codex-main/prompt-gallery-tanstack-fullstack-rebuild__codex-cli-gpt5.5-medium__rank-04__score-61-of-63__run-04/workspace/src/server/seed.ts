export const creators = [
  { id: 1, name: 'Atlas Studio', handle: 'atlas', commissionRate: 0.85 },
  { id: 2, name: 'Lumen', handle: 'lumen', commissionRate: 0.85 },
  { id: 3, name: 'Field & Co.', handle: 'field', commissionRate: 0.85 },
  { id: 4, name: 'Ops Guild', handle: 'ops', commissionRate: 0.85 },
]

export const categories = [
  'Image',
  'Photography',
  'Design',
  'Writing',
  'Code',
  'Marketing',
  'Productivity',
  'Research',
]

export const prompts = [
  [207, 'Cinematic Still, 35mm', 'Midjourney', 'Image', 9, 4700, 5.0, 1, '3/4', 'Film-grade stills with real lens language, focal length, grain, and lighting that reads as cinema.', 1, '2026-06-27'],
  [233, 'Ink Wash Warrior', 'Midjourney', 'Image', 12, 2100, 4.9, 1, '2/3', 'Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space.', 1, '2026-06-30'],
  [174, 'Editorial Photo Grade', 'Flux', 'Photography', 11, 1300, 4.9, 2, '3/4', 'Magazine-style color grading with warm skin, deep shadow, and a quiet print look.', 0, '2026-07-01'],
  [301, 'Magazine Cover Maker', 'GPT-4o', 'Design', 14, 3300, 4.8, 3, '4/5', 'Drop in a photo, get a full cover: masthead, cover lines, barcode, the works.', 1, '2026-07-07'],
  [118, 'Studio Portrait, Soft Light', 'Flux', 'Photography', 10, 1800, 4.9, 2, '4/5', 'Clean beauty light with believable falloff. Looks shot, not rendered.', 1, '2026-06-26'],
  [198, 'Logo Sketch, Mono-line', 'Midjourney', 'Design', 13, 980, 4.8, 3, '1/1', 'Single-weight line marks with real negative-space thinking. Vector-ready directions, fast.', 0, '2026-07-02'],
  [142, 'The Cold-Email Closer', 'GPT-4o', 'Marketing', 12, 2300, 4.9, 3, '4/3', 'Cold emails that actually get replies with tested subject-line variants baked in.', 1, '2026-07-04'],
  [160, 'Senior Code Reviewer', 'Claude', 'Code', 18, 1100, 4.8, 4, '1/1', 'Reviews your diff like a staff engineer, catches risk, suggests fixes, explains the why.', 0, '2026-07-03'],
  [255, 'Neon Street, Night', 'Flux', 'Photography', 8, 2600, 4.7, 2, '3/4', 'Rain-slick neon with real reflections and grain. A cinematic night street look.', 1, '2026-07-05'],
  [189, 'Brand Voice, Bottled', 'Claude', 'Marketing', 24, 860, 4.9, 3, '4/3', 'Feed it three samples; get a reusable voice guide that writes in your exact tone.', 1, '2026-06-29'],
  [211, 'Anime Key Visual', 'Midjourney', 'Image', 15, 3900, 5.0, 1, '2/3', 'Poster-grade key art with depth, rim light, and a real focal subject.', 1, '2026-07-06'],
  [31, 'The Socratic Tutor', 'GPT-4o', 'Research', 0, 9200, 4.7, 4, '5/4', 'Never hands you the answer. Leads you there with questions at the right difficulty.', 1, '2026-06-24'],
  [276, 'Product Shot, White BG', 'Flux', 'Photography', 9, 1500, 4.8, 2, '1/1', 'Clean e-commerce hero shots with soft contact shadow. Drop-in ready for storefronts.', 0, '2026-07-08'],
  [212, "The Worldbuilder's Bible", 'GPT-4o', 'Writing', 29, 720, 5.0, 4, '4/5', 'Builds a consistent fictional world: geography, factions, history, and continuity.', 1, '2026-06-28'],
  [248, 'Vintage Film Poster', 'Midjourney', 'Design', 13, 2200, 4.9, 3, '3/4', '70s grain, bold type, halftone. One-sheets that look pulled from an archive.', 1, '2026-07-01'],
  [156, 'Bug-to-Test Generator', 'GPT-4o', 'Code', 15, 1900, 4.8, 4, '4/3', 'Paste a bug report, get a failing test plus the fix and edge cases.', 0, '2026-07-06'],
  [267, 'Dreamy Bokeh Portrait', 'Flux', 'Photography', 10, 1700, 4.8, 2, '4/5', 'Creamy backgrounds, golden-hour warmth, eyes in razor focus.', 1, '2026-07-03'],
  [101, 'Meeting -> Memo', 'Claude', 'Productivity', 6, 5100, 4.7, 4, '4/3', 'Turns a messy transcript into a crisp decision memo: owners, dates, and next steps.', 1, '2026-07-02'],
]

export const orderSeed = [
  ['2026-07-01', 207, 9, 12],
  ['2026-07-01', 31, 0, 30],
  ['2026-07-02', 101, 6, 18],
  ['2026-07-02', 142, 12, 10],
  ['2026-07-03', 160, 18, 7],
  ['2026-07-03', 267, 10, 11],
  ['2026-07-04', 211, 15, 16],
  ['2026-07-05', 255, 8, 20],
  ['2026-07-06', 301, 14, 14],
  ['2026-07-06', 156, 15, 9],
  ['2026-07-07', 189, 24, 6],
  ['2026-07-08', 276, 9, 12],
]
