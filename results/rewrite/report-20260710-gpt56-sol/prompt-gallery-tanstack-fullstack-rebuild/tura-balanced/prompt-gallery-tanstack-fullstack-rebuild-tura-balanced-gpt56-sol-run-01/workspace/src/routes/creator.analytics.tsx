import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsPage } from '~/components/AnalyticsPage'
import { getCreatorAnalytics } from '~/server/marketplace.functions'

export const Route = createFileRoute('/creator/analytics')({ loader: () => getCreatorAnalytics(), component: AnalyticsRoute })

function AnalyticsRoute() {
  return <AnalyticsPage data={Route.useLoaderData()} />
}
