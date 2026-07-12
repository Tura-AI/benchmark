import { createFileRoute } from '@tanstack/react-router'
import { catalogInputSchema } from '../contracts/marketplace'
import { Storefront } from '../components/Storefront'
import { getCatalogFn } from '../server/functions'

export const Route = createFileRoute('/')({
  validateSearch: catalogInputSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getCatalogFn({ data: deps }),
  component: StoreRoute,
})

function StoreRoute() {
  return <Storefront data={Route.useLoaderData()} search={Route.useSearch()} />
}
