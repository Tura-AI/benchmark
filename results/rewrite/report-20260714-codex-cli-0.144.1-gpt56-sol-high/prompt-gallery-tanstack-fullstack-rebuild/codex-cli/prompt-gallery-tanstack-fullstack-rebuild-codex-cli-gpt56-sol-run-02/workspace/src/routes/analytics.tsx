import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsPage } from '../components/AnalyticsPage'
import { getAnalytics } from '../data/marketplace.functions'

export const Route = createFileRoute('/analytics')({ loader: () => getAnalytics(), component: AnalyticsRoute })
function AnalyticsRoute() { return <AnalyticsPage data={Route.useLoaderData()} /> }
