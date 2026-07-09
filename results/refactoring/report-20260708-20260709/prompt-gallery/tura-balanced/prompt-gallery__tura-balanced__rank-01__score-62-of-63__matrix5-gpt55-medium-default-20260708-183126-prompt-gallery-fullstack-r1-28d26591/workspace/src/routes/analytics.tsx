import { createFileRoute } from '@tanstack/react-router'

import { AppShell } from '../components/AppShell'
import { getAnalyticsFn, getCartFn } from '../server/queries'

export const Route = createFileRoute('/analytics')({
  loader: async () => {
    const [analytics, cart] = await Promise.all([getAnalyticsFn(), getCartFn()])
    return { analytics, cart }
  },
  component: AnalyticsRoute,
})

function money(value: number) { return `$${value.toFixed(2)}` }

function AnalyticsRoute() {
  const { analytics, cart } = Route.useLoaderData()
  return (
    <AppShell cartCount={cart.totals.itemCount}>
      <div className="analytics-page">
        <h1>Creator analytics</h1>
        <div className="metric-grid">
          <div className="metric"><div className="k">Revenue</div><div className="v">{money(analytics.overview.revenue)}</div></div>
          <div className="metric"><div className="k">Orders</div><div className="v">{analytics.overview.orders}</div></div>
          <div className="metric"><div className="k">Avg order</div><div className="v">{money(analytics.overview.averageOrderValue)}</div></div>
          <div className="metric"><div className="k">Conversion</div><div className="v">{analytics.overview.conversionRate}x</div></div>
        </div>
        <section className="table" aria-label="Creator revenue">
          {analytics.creatorRevenue.map((row) => <div key={row.creator}><strong>{row.creator}</strong><span>{money(row.revenue)}</span><span>{money(row.payout)} payout</span></div>)}
        </section>
        <section className="table" aria-label="Category revenue">
          {analytics.categoryRevenue.map((row) => <div key={row.category}><strong>{row.category}</strong><span>{money(row.revenue)}</span><span>{row.units} units</span></div>)}
        </section>
        <section className="table" aria-label="Daily sales trend">
          {analytics.dailySales.map((row) => <div key={row.day}><strong>{row.day}</strong><span>{money(row.revenue)}</span><span>{row.orders} orders</span></div>)}
        </section>
      </div>
    </AppShell>
  )
}
