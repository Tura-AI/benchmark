import type { DatabaseSync } from 'node:sqlite'

const creators = [
  ['c1', 'Forme Studio', '@forme'], ['c2', 'Aquarelle', '@aquarelle'],
  ['c3', 'H. Mbeki', '@hmbeki'], ['c4', 'Lina Park', '@linap'],
]
const categories = ['Image', 'Photography', 'Design', 'Writing', 'Code', 'Marketing', 'Productivity', 'Research']
const media = (name: string) => `/media/prompts/${name}/generate-media-replicate_z_image_turbo-1.png`
const prompts = [
  ['sculptural-interiors','Sculptural Interiors','Midjourney','Design',1200,2700,4.9,'c1','chair','2/3',1,'2026-07-08','Quiet interiors with believable materials, gallery light, and precise furniture forms.'],
  ['still-water-stories','Still Water Stories','Flux','Photography',0,4200,4.8,'c2','boat','3/2',1,'2026-07-06','Overhead documentary images with restrained color and calm, graphic composition.'],
  ['editorial-portrait-director','Editorial Portrait Director','Midjourney','Photography',1800,3800,4.9,'c1','portrait','2/3',1,'2026-07-09','Direct distinctive portraits with purposeful wardrobe, posture, and natural studio light.'],
  ['material-study','Material Study','Flux','Image',900,1900,4.7,'c2','still-life','1/1',0,'2026-06-28','Product still lifes built from tactile materials, exact shadows, and disciplined color.'],
  ['nordic-cabin-architect','Nordic Cabin Architect','GPT-4o','Design',1400,1600,4.8,'c1','cabin','3/2',1,'2026-07-04','Architectural concepts grounded in buildable details and atmospheric landscape photography.'],
  ['plot-doctor','The Plot Doctor','Claude','Writing',1600,1400,4.9,'c3','writer','2/3',1,'2026-07-10','Diagnoses why your story stalls and prescribes the fix: stakes, pacing, and the scene you are dodging.'],
  ['brand-system-builder','Brand System Builder','GPT-4o','Marketing',2200,980,4.7,'c4','paper','1/1',0,'2026-06-30','Turns positioning into a compact verbal and visual direction your team can actually use.'],
  ['automotive-campaign','Automotive Campaign','Midjourney','Image',1200,3100,4.8,'c1','automotive','3/2',1,'2026-07-02','Automotive renders with believable studio reflections and a real sense of scale.'],
  ['research-naturalist','Research Naturalist','GPT-4o','Research',700,2300,4.6,'c4','beetle','2/3',0,'2026-06-25','Structures field observations, taxonomy notes, and evidence into a concise research brief.'],
  ['recipe-editor','Recipe Editor','Claude','Productivity',0,3700,4.8,'c3','tart','1/1',1,'2026-07-01','Edits recipes for timing, clarity, substitutions, and reliable home-kitchen results.'],
  ['expedition-planner','Expedition Planner','GPT-4o','Research',1100,1250,4.7,'c4','desert','3/2',0,'2026-06-20','Builds realistic field itineraries around distance, weather, risk, and local context.'],
  ['watercolor-cityscape','Watercolor Cityscape','Flux','Image',900,2000,4.9,'c2','watercolor','2/3',1,'2026-07-07','Loose, luminous washes with confident linework, soft skies, and lived-in streets.'],
]

export function seedDatabase(db: DatabaseSync) {
  const insertCreator = db.prepare('INSERT INTO creators(id,name,handle) VALUES(?,?,?)')
  creators.forEach((row) => insertCreator.run(...row))
  const insertCategory = db.prepare('INSERT INTO categories(id,name,position) VALUES(?,?,?)')
  categories.forEach((name, index) => insertCategory.run(name.toLowerCase(), name, index))
  const insertPrompt = db.prepare(`INSERT INTO prompts
    (id,title,model,category_id,price_cents,sold,rating,creator_id,image,aspect,featured,created_at,description)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  prompts.forEach(([id,title,model,category,price,sold,rating,creator,image,aspect,featured,created,description]) =>
    insertPrompt.run(id,title,model,String(category).toLowerCase(),price,sold,rating,creator,media(String(image)),aspect,featured,created,description))
  db.prepare("INSERT INTO users VALUES('demo-user','collector@powerprompt.local','2026-06-01')").run()
  db.prepare("INSERT INTO favorites VALUES('demo-user','watercolor-cityscape','2026-07-08')").run()
  db.prepare("INSERT INTO cart_items VALUES('demo-user','material-study',1,'2026-07-09')").run()
  const insertOrder = db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?)')
  const insertItem = db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?)')
  const orderRows = [
    ['o1','completed','2026-07-04','sculptural-interiors','c1',1200],
    ['o2','completed','2026-07-05','plot-doctor','c3',1600],
    ['o3','completed','2026-07-06','watercolor-cityscape','c2',900],
    ['o4','completed','2026-07-07','automotive-campaign','c1',1200],
    ['o5','completed','2026-07-08','brand-system-builder','c4',2200],
    ['o6','refunded','2026-07-08','material-study','c2',900],
    ['o7','completed','2026-07-09','nordic-cabin-architect','c1',1400],
  ]
  orderRows.forEach(([id,status,day,prompt,creator,price]) => {
    const fee = Math.round(Number(price) * .05)
    insertOrder.run(id,'demo-user',status,price,fee,Number(price)+fee,`${day}T12:00:00Z`)
    insertItem.run(id,prompt,creator,1,price)
  })
  const metric = db.prepare('INSERT INTO daily_metrics VALUES(?,?,?)')
  ;[['2026-07-04',210,18],['2026-07-05',240,21],['2026-07-06',265,25],['2026-07-07',290,28],['2026-07-08',340,31],['2026-07-09',390,38]].forEach((r) => metric.run(...r))
}
