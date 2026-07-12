export const creators = [
  [1, 'Atlas Studio', '@atlas', 18400],
  [2, 'Field & Co.', '@fieldandco', 12750],
  [3, 'Lumen', '@lumen', 21300],
  [4, 'Ops Guild', '@opsguild', 9800],
] as const

const images = [
  '/images/generate-media-replicate_z_image_turbo-1.webp',
  '/images/generate-media-replicate_z_image_turbo-1-1.webp',
  '/images/generate-media-replicate_z_image_turbo-1-2.webp',
  '/images/generate-media-replicate_z_image_turbo-1-3.webp',
  '/images/generate-media-replicate_z_image_turbo-1-4.webp',
  '/images/generate-media-replicate_z_image_turbo-1-5.webp',
  '/images/generate-media-replicate_z_image_turbo-1-6.webp',
  '/images/generate-media-replicate_z_image_turbo-1-7.webp',
  '/images/generate-media-replicate_z_image_turbo-1-8.webp',
  '/images/generate-media-replicate_z_image_turbo-1-9.webp',
  '/images/generate-media-replicate_z_image_turbo-1-10.webp',
  '/images/generate-media-replicate_z_image_turbo-1-11.webp',
]

type SeedPrompt = readonly [number, string, string, string, number, number, number, number, string, string]
const raw: SeedPrompt[] = [
  [207,'Cinematic Still, 35mm','Midjourney','Image',9,4700,5,1,'3/4','Film-grade stills with real lens language, focal length, grain, and light that reads as cinema.'],
  [233,'Ink Wash Warrior','Midjourney','Image',12,2100,4.9,1,'2/3','Sumi-e meets splash ink: dramatic monochrome heroes with controlled negative space.'],
  [174,'Editorial Photo Grade','Flux','Photography',11,1300,4.9,3,'3/4','Magazine color grading with warm skin, deep shadow, and a quiet print finish.'],
  [301,'Magazine Cover Maker','GPT-4o','Design',14,3300,4.8,2,'4/5','Build a complete editorial cover system around any supplied image.'],
  [118,'Studio Portrait, Soft Light','Flux','Photography',10,1800,4.9,3,'4/5','Clean beauty light with believable falloff. Looks photographed, not rendered.'],
  [198,'Logo Sketch, Mono-line','Midjourney','Design',13,980,4.8,2,'1/1','Single-weight line marks with real negative-space thinking and vector-ready directions.'],
  [142,'The Cold-Email Closer','GPT-4o','Marketing',12,2300,4.9,2,'4/3','A tested four-line outreach structure with useful subject-line variants.'],
  [160,'Senior Code Reviewer','Claude','Code',18,1100,4.8,4,'1/1','Reviews a diff like a staff engineer: catches risk, suggests fixes, explains why.'],
  [255,'Neon Street, Night','Flux','Photography',8,2600,4.7,1,'3/4','Rain-slick neon, grounded reflections, fine grain, and candid night framing.'],
  [189,'Brand Voice, Bottled','Claude','Marketing',24,860,4.9,2,'4/3','Turns three writing samples into a reusable voice guide with practical constraints.'],
  [211,'Anime Key Visual','Midjourney','Image',15,3900,5,1,'2/3','Poster-grade key art with layered depth and a decisive focal subject.'],
  [31,'The Socratic Tutor','GPT-4o','Research',0,9200,4.7,4,'5/4','Leads learners to the answer with questions calibrated to the right difficulty.'],
  [276,'Product Shot, White BG','Flux','Photography',9,1500,4.8,3,'1/1','Clean e-commerce product shots with subtle contact shadow and controlled reflections.'],
  [212,"The Worldbuilder's Bible",'GPT-4o','Writing',29,720,5,4,'4/5','Builds consistent geography, factions, history, and long-form continuity.'],
  [248,'Vintage Film Poster','Midjourney','Design',13,2200,4.9,2,'3/4','Sun-faded color, bold composition, and archival halftone texture.'],
  [156,'Bug-to-Test Generator','GPT-4o','Code',15,1900,4.8,4,'4/3','Turns a bug report into a failing test, a focused fix, and edge-case coverage.'],
  [267,'Dreamy Bokeh Portrait','Flux','Photography',10,1700,4.8,3,'4/5','Creamy backgrounds, warm late-day light, and carefully held eye focus.'],
  [101,'Meeting to Memo','Claude','Productivity',6,5100,4.7,4,'4/3','Converts a rough transcript into a clear decision memo with owners and dates.'],
  [290,'Concept Car, Studio','Midjourney','Image',12,1400,4.8,1,'3/2','Automotive studies with believable studio reflections and grounded scale.'],
  [77,'The Plot Doctor','Claude','Writing',16,1400,4.9,4,'1/1','Diagnoses stalled stories through stakes, pacing, and scene-level choices.'],
  [221,'Watercolor Cityscape','Flux','Image',9,2000,4.9,1,'3/4','Loose luminous washes, confident linework, soft skies, and active streets.'],
  [63,'Inbox Zero Strategist','Claude','Productivity',8,3400,4.6,4,'4/3','Triages, drafts, and schedules a full inbox around what moves the week.'],
]

export const prompts = raw.map((p, index) => ({
  id:p[0], title:p[1], model:p[2], category:p[3], price:p[4], sold:p[5], rating:p[6], creatorId:p[7], aspectRatio:p[8], description:p[9],
  image:images[index % images.length], featured:index < 8 ? 1 : 0,
  createdAt:`2026-06-${String(28 - index).padStart(2,'0')}T12:00:00Z`,
}))

export const orderSeeds = [
  [1001,1,'completed','2026-07-03T10:00:00Z'],[1002,1,'completed','2026-07-04T13:00:00Z'],
  [1003,1,'completed','2026-07-05T09:00:00Z'],[1004,1,'completed','2026-07-05T17:00:00Z'],
  [1005,1,'completed','2026-07-07T15:00:00Z'],[1006,1,'completed','2026-07-08T11:00:00Z'],
] as const

export const orderItemSeeds = [
  [1001,207,9],[1001,142,12],[1002,118,10],[1002,31,0],[1003,301,14],
  [1003,189,24],[1004,160,18],[1005,211,15],[1005,276,9],[1006,101,6],
] as const
