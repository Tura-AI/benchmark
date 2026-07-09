import type { ModelName } from './types'

export const userId = 1

export const creators = [
  { id: 1, name: 'Atlas Studio', handle: '@atlas', commissionRate: 0.82 },
  { id: 2, name: 'Lumen', handle: '@lumen', commissionRate: 0.8 },
  { id: 3, name: 'Field & Co.', handle: '@fieldco', commissionRate: 0.78 },
  { id: 4, name: 'Ops Guild', handle: '@opsguild', commissionRate: 0.84 },
  { id: 5, name: 'Sakuga', handle: '@sakuga', commissionRate: 0.81 },
  { id: 6, name: 'Claude Lab', handle: '@claudelab', commissionRate: 0.79 },
]

export const categories = ['Image', 'Photography', 'Design', 'Writing', 'Code', 'Marketing', 'Productivity', 'Research']

export const prompts: Array<{
  id: number
  title: string
  model: ModelName
  category: string
  price: number
  sold: number
  rating: number
  creatorId: number
  aspectRatio: string
  description: string
}> = [
  { id: 207, title: 'Cinematic Still, 35mm', model: 'Midjourney', category: 'Image', price: 9, sold: 4700, rating: 5, creatorId: 1, aspectRatio: '3/4', description: 'Film-grade stills with real lens language, focal length, grain, and lighting that reads as cinema.' },
  { id: 233, title: 'Ink Wash Warrior', model: 'Midjourney', category: 'Image', price: 12, sold: 2100, rating: 4.9, creatorId: 5, aspectRatio: '2/3', description: 'Sumi-e meets splash ink. Dramatic monochrome heroes with controlled negative space.' },
  { id: 174, title: 'Editorial Photo Grade', model: 'Flux', category: 'Photography', price: 11, sold: 1300, rating: 4.9, creatorId: 2, aspectRatio: '3/4', description: 'Magazine-style color grading. Warm skin, deep shadow, that quiet print look without garish presets.' },
  { id: 301, title: 'Magazine Cover Maker', model: 'GPT-4o', category: 'Design', price: 14, sold: 3300, rating: 4.8, creatorId: 3, aspectRatio: '4/5', description: 'Drop in a photo and get a full cover system with masthead, cover lines, barcode, and layout notes.' },
  { id: 118, title: 'Studio Portrait, Soft Light', model: 'Flux', category: 'Photography', price: 10, sold: 1800, rating: 4.9, creatorId: 2, aspectRatio: '4/5', description: 'Clean beauty light with a believable falloff. Looks shot, not rendered.' },
  { id: 198, title: 'Logo Sketch, Mono-line', model: 'Midjourney', category: 'Design', price: 13, sold: 980, rating: 4.8, creatorId: 3, aspectRatio: '1/1', description: 'Single-weight line marks with real negative-space thinking. Vector-ready directions, fast.' },
  { id: 142, title: 'The Cold-Email Closer', model: 'GPT-4o', category: 'Marketing', price: 12, sold: 2300, rating: 4.9, creatorId: 3, aspectRatio: '4/3', description: 'Cold emails that get replies. A tested four-line structure with subject-line variants baked in.' },
  { id: 160, title: 'Senior Code Reviewer', model: 'Claude', category: 'Code', price: 18, sold: 1100, rating: 4.8, creatorId: 6, aspectRatio: '1/1', description: 'Reviews your diff like a staff engineer, catches risk, suggests fixes, and explains the why.' },
  { id: 255, title: 'Neon Street, Night', model: 'Flux', category: 'Photography', price: 8, sold: 2600, rating: 4.7, creatorId: 2, aspectRatio: '3/4', description: 'Rain-slick neon with real reflections and grain. That low-budget cyberpunk look, nailed.' },
  { id: 189, title: 'Brand Voice, Bottled', model: 'Claude', category: 'Marketing', price: 24, sold: 860, rating: 4.9, creatorId: 3, aspectRatio: '4/3', description: 'Feed it three samples; get a reusable voice guide that writes anything in your exact tone.' },
  { id: 211, title: 'Anime Key Visual', model: 'Midjourney', category: 'Image', price: 15, sold: 3900, rating: 5, creatorId: 5, aspectRatio: '2/3', description: 'Poster-grade key art with depth, light direction, and a real focal subject. Print at A2.' },
  { id: 31, title: 'The Socratic Tutor', model: 'GPT-4o', category: 'Research', price: 0, sold: 9200, rating: 4.7, creatorId: 4, aspectRatio: '5/4', description: 'Never hands you the answer; leads you there with questions at exactly the right difficulty.' },
  { id: 276, title: 'Product Shot, White BG', model: 'Flux', category: 'Photography', price: 9, sold: 1500, rating: 4.8, creatorId: 2, aspectRatio: '1/1', description: 'Clean e-commerce hero shots with soft contact shadow. Drop-in ready for any storefront.' },
  { id: 212, title: "The Worldbuilder's Bible", model: 'GPT-4o', category: 'Writing', price: 29, sold: 720, rating: 5, creatorId: 6, aspectRatio: '4/5', description: 'Builds a consistent fictional world: geography, factions, history, and continuity.' },
  { id: 248, title: 'Vintage Film Poster', model: 'Midjourney', category: 'Design', price: 13, sold: 2200, rating: 4.9, creatorId: 1, aspectRatio: '3/4', description: '70s grain, bold type, halftone, and one-sheets that look pulled from an archive.' },
  { id: 156, title: 'Bug-to-Test Generator', model: 'GPT-4o', category: 'Code', price: 15, sold: 1900, rating: 4.8, creatorId: 6, aspectRatio: '4/3', description: 'Paste a bug report, get a failing test that reproduces it, plus the fix and edge cases.' },
  { id: 267, title: 'Dreamy Bokeh Portrait', model: 'Flux', category: 'Photography', price: 10, sold: 1700, rating: 4.8, creatorId: 2, aspectRatio: '4/5', description: 'Creamy backgrounds, golden-hour warmth, eyes in razor focus. Pure mood.' },
  { id: 101, title: 'Meeting to Memo', model: 'Claude', category: 'Productivity', price: 6, sold: 5100, rating: 4.7, creatorId: 4, aspectRatio: '4/3', description: 'Turns a messy transcript into a crisp decision memo: owners, dates, and the thing that matters.' },
  { id: 290, title: 'Concept Car, Studio', model: 'Midjourney', category: 'Image', price: 12, sold: 1400, rating: 4.8, creatorId: 1, aspectRatio: '3/2', description: 'Automotive design renders with believable studio reflections and a real sense of scale.' },
  { id: 77, title: 'The Plot Doctor', model: 'Claude', category: 'Writing', price: 16, sold: 1400, rating: 4.9, creatorId: 6, aspectRatio: '1/1', description: 'Diagnoses why your story stalls and prescribes the fix: stakes, pacing, and the scene you are dodging.' },
  { id: 221, title: 'Watercolor Cityscape', model: 'Flux', category: 'Image', price: 9, sold: 2000, rating: 4.9, creatorId: 1, aspectRatio: '3/4', description: 'Loose, luminous washes with confident linework. Soft skies, busy streets.' },
  { id: 63, title: 'Inbox Zero Strategist', model: 'Claude', category: 'Productivity', price: 8, sold: 3400, rating: 4.6, creatorId: 4, aspectRatio: '4/3', description: 'Triage, draft, and schedule a full inbox in one pass, sorted by what moves your week.' },
]
