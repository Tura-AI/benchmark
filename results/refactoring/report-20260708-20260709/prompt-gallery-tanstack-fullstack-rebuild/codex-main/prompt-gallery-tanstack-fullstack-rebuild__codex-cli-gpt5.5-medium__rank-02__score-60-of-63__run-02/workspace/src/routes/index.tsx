import { createFileRoute } from '@tanstack/react-router'
import { Marketplace } from '../components/Marketplace'
import { apiUrl } from '../utils/api-url'

export const Route = createFileRoute('/')({
  loader: async () => {
    const res = await fetch(apiUrl('/api/catalog?sort=featured'))
    return res.json()
  },
  component: Storefront,
})

function Storefront() {
  const catalog = Route.useLoaderData()
  return <Marketplace initial={catalog} />
}
