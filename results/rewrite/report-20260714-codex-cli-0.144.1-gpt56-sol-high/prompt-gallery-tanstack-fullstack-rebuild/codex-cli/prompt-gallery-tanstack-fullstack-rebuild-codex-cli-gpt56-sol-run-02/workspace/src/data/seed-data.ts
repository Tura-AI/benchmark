export const categories = ['Image', 'Photography', 'Design', 'Writing', 'Code', 'Marketing', 'Productivity', 'Research']

export const creators = [
  ['Atlas Studio', '@atlas', 'AS'],
  ['Field & Co.', '@fieldandco', 'FC'],
  ['Lumen', '@lumen', 'LU'],
  ['Ops Guild', '@opsguild', 'OG'],
] as const

export const prompts = [
  [207,'cinematic-still-35mm','Cinematic Still, 35mm','Midjourney','Image',9,4700,5.0,1,'3/4','Film-grade stills with real lens language — focal length, grain, and lighting that reads as cinema.'],
  [233,'ink-wash-warrior','Ink Wash Warrior','Midjourney','Image',12,2100,4.9,1,'2/3','Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space.'],
  [174,'editorial-photo-grade','Editorial Photo Grade','Flux','Photography',11,1300,4.9,3,'3/4','Magazine-style color grading. Warm skin, deep shadow, that quiet print look — no garish presets.'],
  [301,'magazine-cover-maker','Magazine Cover Maker','GPT-4o','Design',14,3300,4.8,2,'4/5','Drop in a photo, get a full cover — masthead, cover lines, barcode, the works.'],
  [118,'studio-portrait-soft-light','Studio Portrait, Soft Light','Flux','Photography',10,1800,4.9,3,'4/5','Clean beauty light with a believable falloff. Looks shot, not rendered.'],
  [198,'logo-sketch-mono-line','Logo Sketch, Mono-line','Midjourney','Design',13,980,4.8,1,'1/1','Single-weight line marks with real negative-space thinking. Vector-ready directions, fast.'],
  [142,'the-cold-email-closer','The Cold-Email Closer','GPT-4o','Marketing',12,2300,4.9,2,'4/3','Cold emails that actually get replies. A tested 4-line structure with subject-line variants baked in.'],
  [160,'senior-code-reviewer','Senior Code Reviewer','Claude','Code',18,1100,4.8,4,'1/1','Reviews your diff like a staff engineer — catches risk, suggests fixes, explains the why.'],
  [255,'neon-street-night','Neon Street, Night','Flux','Photography',8,2600,4.7,3,'3/4','Rain-slick neon with real reflections and grain. That blade-runner-on-a-budget look, nailed.'],
  [189,'brand-voice-bottled','Brand Voice, Bottled','Claude','Marketing',24,860,4.9,2,'4/3','Feed it three samples; get a reusable voice guide that writes anything in your exact tone.'],
  [211,'anime-key-visual','Anime Key Visual','Midjourney','Image',15,3900,5.0,1,'2/3','Poster-grade key art with depth, rim light, and a real focal subject. Print at A2.'],
  [31,'the-socratic-tutor','The Socratic Tutor','GPT-4o','Research',0,9200,4.7,4,'5/4','Never hands you the answer — leads you there with questions at exactly the right difficulty.'],
  [276,'product-shot-white-bg','Product Shot, White BG','Flux','Photography',9,1500,4.8,3,'1/1','Clean e-commerce hero shots with soft contact shadow. Drop-in ready for any storefront.'],
  [212,'the-worldbuilders-bible',"The Worldbuilder's Bible",'GPT-4o','Writing',29,720,5.0,4,'4/5','Builds a consistent fictional world — geography, factions, history — and holds continuity.'],
  [248,'vintage-film-poster','Vintage Film Poster','Midjourney','Design',13,2200,4.9,1,'3/4','70s grain, bold type, halftone. One-sheets that look pulled from an archive.'],
  [156,'bug-to-test-generator','Bug-to-Test Generator','GPT-4o','Code',15,1900,4.8,4,'4/3','Paste a bug report, get a failing test that reproduces it — plus the fix and the edge cases.'],
  [267,'dreamy-bokeh-portrait','Dreamy Bokeh Portrait','Flux','Photography',10,1700,4.8,3,'4/5','Creamy backgrounds, golden-hour warmth, eyes in razor focus. Pure mood.'],
  [101,'meeting-to-memo','Meeting → Memo','Claude','Productivity',6,5100,4.7,4,'4/3','Turns a messy transcript into a crisp decision memo: owners, dates, the one thing that matters.'],
  [290,'concept-car-studio','Concept Car, Studio','Midjourney','Image',12,1400,4.8,1,'3/2','Automotive design renders with believable studio reflections and a real sense of scale.'],
  [77,'the-plot-doctor','The Plot Doctor','Claude','Writing',16,1400,4.9,4,'1/1','Diagnoses why your story stalls and prescribes the fix — stakes, pacing, the scene you’re dodging.'],
  [221,'watercolor-cityscape','Watercolor Cityscape','Flux','Image',9,2000,4.9,3,'3/4','Loose, luminous washes with confident linework. Soft skies, busy streets.'],
  [63,'inbox-zero-strategist','Inbox Zero Strategist','Claude','Productivity',8,3400,4.6,4,'4/3','Triage, draft, and schedule a full inbox in one pass — sorted by what moves your week.'],
] as const

export const orders = [
  ['PP-1041','completed','2026-07-08T09:20:00Z',1],
  ['PP-1042','completed','2026-07-09T14:10:00Z',1],
  ['PP-1043','completed','2026-07-10T17:45:00Z',1],
  ['PP-1044','completed','2026-07-11T10:12:00Z',1],
  ['PP-1045','completed','2026-07-12T12:30:00Z',1],
  ['PP-1046','completed','2026-07-13T18:05:00Z',1],
  ['PP-1047','completed','2026-07-14T08:40:00Z',1],
  ['PP-1048','refunded','2026-07-14T11:00:00Z',1],
] as const

export const orderItems = [
  [1,207,2,9],[1,233,1,12],[2,301,1,14],[2,142,1,12],[3,160,1,18],
  [3,255,2,8],[4,211,1,15],[4,101,2,6],[5,189,1,24],[5,276,1,9],
  [6,248,2,13],[6,156,1,15],[7,212,1,29],[7,267,2,10],[8,77,1,16],
] as const
