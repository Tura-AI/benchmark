import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsPage } from '../components/AnalyticsPage'
import { analyticsFn, getCartFn } from '../server/marketplace.functions'
export const Route=createFileRoute('/analytics')({loader:async()=>({analytics:await analyticsFn(),cart:await getCartFn()}),component:Page})
function Page(){return <AnalyticsPage {...Route.useLoaderData()}/>}
