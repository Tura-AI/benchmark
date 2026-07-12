import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { checkout, getAnalytics, getCartTotals, getCatalogCounts, getCategories, getPrompt, listPrompts, toggleCart, toggleFavorite } from '../data/queries.server'

const filtersSchema=z.object({model:z.string().optional(),category:z.string().optional(),sort:z.enum(['featured','newest','popular']).optional(),q:z.string().max(80).optional(),favorites:z.boolean().optional(),price:z.enum(['all','free','paid']).optional()})
const idSchema=z.object({promptId:z.number().int().positive()})

export const getCatalogFn=createServerFn({method:'GET'}).validator(filtersSchema).handler(({data})=>({prompts:listPrompts(data),categories:getCategories(),counts:getCatalogCounts(),cart:getCartTotals()}))
export const getPromptFn=createServerFn({method:'GET'}).validator(idSchema).handler(({data})=>{const prompt=getPrompt(data.promptId);if(!prompt) throw new Error('Prompt not found');return prompt})
export const favoriteFn=createServerFn({method:'POST'}).validator(idSchema).handler(({data})=>toggleFavorite(data.promptId))
export const cartFn=createServerFn({method:'POST'}).validator(idSchema).handler(({data})=>toggleCart(data.promptId))
export const getCartFn=createServerFn({method:'GET'}).handler(()=>getCartTotals())
export const checkoutFn=createServerFn({method:'POST'}).handler(()=>checkout())
export const analyticsFn=createServerFn({method:'GET'}).handler(()=>getAnalytics())
