import { createFileRoute } from '@tanstack/react-router'
import { loadAnalytics } from '~/data/server'
import { FormatMoney } from '~/ui/FormatMoney'

export const Route = createFileRoute('/admin/analytics')({
  loader: () => loadAnalytics(),
  component: AnalyticsPage,
})

function AnalyticsPage() {
  const analytics = Route.useLoaderData()
  return (
    <main className="analytics-page">
      <a className="back-link" href="/">POWERPROMPT Gallery</a>
      <section className="analytics-head">
        <h1>Creator analytics</h1>
        <div><span>Total revenue</span><b><FormatMoney value={analytics.totalRevenue} /></b></div>
        <div><span>AOV</span><b><FormatMoney value={analytics.averageOrderValue} /></b></div>
        <div><span>Conversion</span><b>{analytics.conversionRate}%</b></div>
      </section>
      <section className="analytics-grid">
        <div className="panel">
          <h2>Creator revenue</h2>
          {analytics.creatorRevenue.map((row) => (
            <p key={row.creatorId}><span>{row.creator}</span><b><FormatMoney value={row.revenue} /></b></p>
          ))}
        </div>
        <div className="panel">
          <h2>Category totals</h2>
          {analytics.categoryRevenue.map((row) => (
            <p key={row.category}><span>{row.category}</span><b><FormatMoney value={row.revenue} /></b></p>
          ))}
        </div>
        <div className="panel">
          <h2>Daily sales</h2>
          {analytics.trend.map((row) => (
            <p key={row.date}><span>{row.date}</span><b><FormatMoney value={row.revenue} /> ({row.change >= 0 ? '+' : ''}{row.change})</b></p>
          ))}
        </div>
      </section>
    </main>
  )
}
