import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Storefront } from '../components/Storefront'
import { getCatalogFn } from '../server/marketplace.functions'

const searchSchema=z.object({model:z.string().optional(),category:z.string().optional(),sort:z.enum(['featured','newest','popular']).catch('featured').optional(),q:z.string().optional(),favorites:z.boolean().optional(),price:z.enum(['all','free','paid']).optional()})
export const Route=createFileRoute('/')({
  validateSearch:(search)=>searchSchema.parse(search),
  loaderDeps:({search})=>search,
  loader:({deps})=>getCatalogFn({data:deps}),
  component:Page,
})
function Page(){return <Storefront data={Route.useLoaderData()} search={Route.useSearch()}/>}
