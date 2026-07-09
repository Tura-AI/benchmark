import { createFileRoute, Link } from '@tanstack/react-router'
import { getAnalytics } from '../server/functions'
import { money } from '../components/PromptCard'

export const Route = createFileRoute('/admin/analytics')({
  loader: () => getAnalytics(),
  component: AnalyticsRoute,
})

function AnalyticsRoute() {
  const data = Route.useLoaderData() as any
  return <section className="analytics">
    <div className="panel">
      <p className="eyebrow mono">Creator/admin analytics</p>
      <h1>Marketplace performance</h1>
      <div className="analytics-grid">
        <div className="metric"><span>Orders</span><br /><b>{data.summary.orders}</b></div>
        <div className="metric"><span>Revenue</span><br /><b>{money(data.summary.grossCents)}</b></div>
        <div className="metric"><span>Average order value</span><br /><b>{money(data.summary.averageOrderValueCents)}</b></div>
        <div className="metric"><span>Conversion rate</span><br /><b>{data.summary.conversionRate}%</b></div>
      </div>
      <h2>Creator revenue</h2>
      {data.creatorRevenue.map((row: any) => <div className="metric-row" key={row.handle}><span>{row.name} {row.handle}</span><b>{money(row.revenueCents)}</b></div>)}
      <h2>Category revenue</h2>
      {data.categoryRevenue.map((row: any) => <div className="metric-row" key={row.name}><span>{row.name}</span><b>{money(row.revenueCents)}</b></div>)}
      <h2>Daily sales trend</h2>
      {data.dailySales.map((row: any) => <div className="metric-row" key={row.day}><span>{row.day} · {row.orders} order(s)</span><b>{money(row.totalCents)}</b></div>)}
      <Link className="ghost" to="/">Back to storefront</Link>
    </div>
  </section>
}
