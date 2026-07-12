import { createFileRoute } from '@tanstack/react-router'
import { Marketplace } from '~/components/Marketplace'
import { catalogInput } from '~/contracts'
import { getCatalog } from '~/server/marketplace.functions'

export const Route = createFileRoute('/')({
  validateSearch: (search) => catalogInput.partial().parse(search),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getCatalog({ data: catalogInput.parse(deps) }),
  component: Storefront,
})

function Storefront() {
  return <Marketplace initial={Route.useLoaderData()} />
}
