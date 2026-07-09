import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsView } from '@/components/analytics'
import { Shell } from '@/components/layout'
import { getCreatorAnalytics, getStorefront } from '@/server/marketplace'

export const Route = createFileRoute('/admin')({
  loader: async () => {
    const [analytics, shell] = await Promise.all([getCreatorAnalytics(), getStorefront({ data: {} })])
    return { analytics, shell }
  },
  component: AdminRoute,
})

function AdminRoute() {
  const data = Route.useLoaderData()
  return <Shell categories={data.shell.categories} cartCount={data.shell.cart.count}><AnalyticsView analytics={data.analytics} /></Shell>
}
