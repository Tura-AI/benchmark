export type CreatorSeed = { id: string; name: string; handle: string; specialty: string; avatar: string }
export type CategorySeed = { id: string; name: string; color: string }
export type PromptSeed = {
  id: string
  title: string
  slug: string
  model: string
  categoryId: string
  creatorId: string
  priceCents: number
  featured: 0 | 1
  image: string
  ratio: string
  description: string
  tags: string
  sales: number
  views: number
  rating: number
  createdAt: string
}

export const demoUserId = 'user-demo'

export const creators: CreatorSeed[] = [
  { id: 'cr-aurora', name: 'Mira Vale', handle: '@aurora', specialty: 'Fashion campaigns', avatar: 'MV' },
  { id: 'cr-studio', name: 'Jun Park', handle: '@studiojun', specialty: 'Product scenes', avatar: 'JP' },
  { id: 'cr-frame', name: 'Noa Ellis', handle: '@framecraft', specialty: 'Editorial portraits', avatar: 'NE' },
  { id: 'cr-luma', name: 'Inez Cole', handle: '@luma', specialty: 'Cinematic looks', avatar: 'IC' },
]

export const categories: CategorySeed[] = [
  { id: 'makeup', name: 'Makeup', color: '#c9fa46' },
  { id: 'fashion', name: 'Fashion', color: '#f0b7c9' },
  { id: 'product', name: 'Product', color: '#b7d9f0' },
  { id: 'portrait', name: 'Portrait', color: '#e2c7ff' },
  { id: 'video', name: 'Video', color: '#f4ce79' },
]

export const prompts: PromptSeed[] = [
  {
    id: 'p-001', title: 'Gloss Editorial Makeup Shoot', slug: 'gloss-editorial-makeup-shoot', model: 'GPT-4o', categoryId: 'makeup', creatorId: 'cr-frame', priceCents: 1900, featured: 1, ratio: '4 / 5', sales: 184, views: 4200, rating: 4.9, createdAt: '2026-06-20',
    image: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=900&q=80',
    description: 'A structured prompt for close editorial beauty images with gloss texture, clean skin detail, and controlled product language.', tags: 'beauty,skin,editorial,gloss'
  },
  {
    id: 'p-002', title: 'Chrome Lip Macro Builder', slug: 'chrome-lip-macro-builder', model: 'Midjourney', categoryId: 'makeup', creatorId: 'cr-aurora', priceCents: 1200, featured: 1, ratio: '1 / 1', sales: 211, views: 5100, rating: 4.8, createdAt: '2026-06-26',
    image: 'https://images.unsplash.com/photo-1583001931096-959e9a1a6223?auto=format&fit=crop&w=900&q=80',
    description: 'Macro prompt pack for reflective lip finishes, precision lighting, and cosmetic campaign framing.', tags: 'lip,macro,chrome,campaign'
  },
  {
    id: 'p-003', title: 'Soft Studio Foundation Test', slug: 'soft-studio-foundation-test', model: 'Claude', categoryId: 'product', creatorId: 'cr-studio', priceCents: 0, featured: 0, ratio: '3 / 4', sales: 92, views: 2700, rating: 4.6, createdAt: '2026-06-27',
    image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=900&q=80',
    description: 'Free evaluation prompt for shade range product images and softly diffused studio backgrounds.', tags: 'foundation,product,free,studio'
  },
  {
    id: 'p-004', title: 'Flux Beauty Lookbook System', slug: 'flux-beauty-lookbook-system', model: 'Flux', categoryId: 'fashion', creatorId: 'cr-luma', priceCents: 2400, featured: 1, ratio: '5 / 7', sales: 156, views: 3900, rating: 4.7, createdAt: '2026-07-01',
    image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80',
    description: 'A repeatable image system for makeup-led fashion lookbooks with consistent styling and lighting.', tags: 'flux,fashion,lookbook,makeup'
  },
  {
    id: 'p-005', title: 'Luxury Compact Product Render', slug: 'luxury-compact-product-render', model: 'GPT-4o', categoryId: 'product', creatorId: 'cr-studio', priceCents: 1600, featured: 0, ratio: '16 / 11', sales: 121, views: 3100, rating: 4.7, createdAt: '2026-06-19',
    image: 'https://images.unsplash.com/photo-1631214524049-0ebbbe6d81aa?auto=format&fit=crop&w=1000&q=80',
    description: 'Prompt recipe for premium cosmetic packshots with ingredient cues and high-end surface control.', tags: 'product,luxury,packshot,cosmetics'
  },
  {
    id: 'p-006', title: 'Creator UGC Beauty Script', slug: 'creator-ugc-beauty-script', model: 'Claude', categoryId: 'video', creatorId: 'cr-aurora', priceCents: 900, featured: 0, ratio: '9 / 12', sales: 75, views: 2100, rating: 4.5, createdAt: '2026-07-02',
    image: 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=900&q=80',
    description: 'Shot-by-shot prompt and copy framework for beauty creator videos and product demonstrations.', tags: 'ugc,video,script,beauty'
  },
  {
    id: 'p-007', title: 'Clean Girl Portrait Prompt', slug: 'clean-girl-portrait-prompt', model: 'Midjourney', categoryId: 'portrait', creatorId: 'cr-frame', priceCents: 1400, featured: 1, ratio: '4 / 6', sales: 198, views: 4700, rating: 4.9, createdAt: '2026-07-04',
    image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=80',
    description: 'Balanced portrait prompt for natural skin, minimal makeup styling, and believable soft daylight.', tags: 'portrait,natural,daylight,skin'
  },
  {
    id: 'p-008', title: 'High-Contrast Mascara Campaign', slug: 'high-contrast-mascara-campaign', model: 'Flux', categoryId: 'makeup', creatorId: 'cr-luma', priceCents: 1800, featured: 0, ratio: '2 / 3', sales: 142, views: 3550, rating: 4.6, createdAt: '2026-06-22',
    image: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=900&q=80',
    description: 'Prompt for bold eye-focused cosmetic visuals with clean composition and campaign-safe contrast.', tags: 'mascara,eyes,campaign,contrast'
  },
  {
    id: 'p-009', title: 'Skincare Texture Flatlay', slug: 'skincare-texture-flatlay', model: 'GPT-4o', categoryId: 'product', creatorId: 'cr-studio', priceCents: 0, featured: 0, ratio: '1 / 1', sales: 66, views: 1800, rating: 4.4, createdAt: '2026-06-18',
    image: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=900&q=80',
    description: 'Free starter prompt for cream textures, flatlay composition, and ingredient-led cosmetic imagery.', tags: 'skincare,texture,flatlay,free'
  },
  {
    id: 'p-010', title: 'Runway Backstage Beauty', slug: 'runway-backstage-beauty', model: 'Midjourney', categoryId: 'fashion', creatorId: 'cr-aurora', priceCents: 2100, featured: 1, ratio: '16 / 10', sales: 173, views: 4100, rating: 4.8, createdAt: '2026-07-05',
    image: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=1000&q=80',
    description: 'Backstage fashion prompt with realistic makeup prep, textile context, and documentary lighting.', tags: 'runway,backstage,fashion,beauty'
  },
  {
    id: 'p-011', title: 'Minimal Beauty Ad Copy Matrix', slug: 'minimal-beauty-ad-copy-matrix', model: 'Claude', categoryId: 'makeup', creatorId: 'cr-luma', priceCents: 1100, featured: 0, ratio: '7 / 8', sales: 88, views: 2500, rating: 4.5, createdAt: '2026-06-30',
    image: 'https://images.unsplash.com/photo-1567721913486-6585f069b332?auto=format&fit=crop&w=900&q=80',
    description: 'A structured Claude prompt for short beauty ad variants, claims-safe copy, and tone control.', tags: 'copy,ads,beauty,claims'
  },
  {
    id: 'p-012', title: 'Serum Launch Landing Imagery', slug: 'serum-launch-landing-imagery', model: 'Flux', categoryId: 'product', creatorId: 'cr-frame', priceCents: 2600, featured: 1, ratio: '5 / 4', sales: 227, views: 5500, rating: 4.9, createdAt: '2026-07-06',
    image: 'https://images.unsplash.com/photo-1570194065650-d99fb4bedf0a?auto=format&fit=crop&w=1000&q=80',
    description: 'Premium launch prompt for serum bottles, tactile surfaces, and polished ecommerce hero imagery.', tags: 'serum,launch,ecommerce,hero'
  },
]

export const seedOrders = [
  ['ord-001', demoUserId, 4700, 282, 4982, 'paid', '2026-07-01'],
  ['ord-002', demoUserId, 3500, 210, 3710, 'paid', '2026-07-02'],
  ['ord-003', demoUserId, 6200, 372, 6572, 'paid', '2026-07-03'],
  ['ord-004', demoUserId, 2600, 156, 2756, 'paid', '2026-07-06'],
] as const

export const seedOrderItems = [
  ['ord-001', 'p-001', 1900], ['ord-001', 'p-004', 2400], ['ord-001', 'p-003', 0], ['ord-001', 'p-006', 900],
  ['ord-002', 'p-002', 1200], ['ord-002', 'p-007', 1400], ['ord-002', 'p-011', 1100],
  ['ord-003', 'p-010', 2100], ['ord-003', 'p-012', 2600], ['ord-003', 'p-008', 1800],
  ['ord-004', 'p-012', 2600],
] as const
