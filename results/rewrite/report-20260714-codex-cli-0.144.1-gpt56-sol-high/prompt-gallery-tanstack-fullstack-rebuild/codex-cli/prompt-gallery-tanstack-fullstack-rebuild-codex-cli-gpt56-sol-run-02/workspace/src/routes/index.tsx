import { createFileRoute } from '@tanstack/react-router'
import { Storefront } from '../components/Storefront'
import { getCatalog } from '../data/marketplace.functions'

export const Route = createFileRoute('/')({
  loader: () => getCatalog({ data: { sort: 'featured' } }),
  component: StorefrontRoute,
})

function StorefrontRoute() { return <Storefront initial={Route.useLoaderData()} /> }
