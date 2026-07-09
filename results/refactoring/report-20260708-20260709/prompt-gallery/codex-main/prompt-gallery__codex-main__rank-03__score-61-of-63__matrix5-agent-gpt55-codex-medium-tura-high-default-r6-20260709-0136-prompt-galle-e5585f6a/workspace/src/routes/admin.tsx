import { createFileRoute } from '@tanstack/react-router'
import { BarChart3, DollarSign, Percent, TrendingUp } from 'lucide-react'
import type React from 'react'
import { api } from '../market-api'

export const Route = createFileRoute('/admin')({
  loader: () => api.analytics(),
  component: AdminPage,
})

function money(value: number) {
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function AdminPage() {
  const analytics = Route.useLoaderData() as any
  const summary = analytics.summary
  const maxDaily = Math.max(...analytics.daily.map((day: any) => day.revenue), 1)

  return (
    <div className="admin-page">
      <header className="page-head">
        <p className="mono">Creator analytics</p>
        <h1>Revenue, conversion, and prompt demand</h1>
      </header>

      <section className="metric-grid">
        <Metric icon={<DollarSign />} label="Revenue" value={money(summary.revenue)} />
        <Metric icon={<BarChart3 />} label="Average order value" value={money(summary.averageOrderValue)} />
        <Metric icon={<Percent />} label="Conversion rate" value={`${Math.round(summary.conversionRate * 1000) / 10}%`} />
        <Metric icon={<TrendingUp />} label="Average paid price" value={money(summary.averagePrice)} />
      </section>

      <section className="analytics-grid">
        <div className="panel">
          <h2>Creator revenue</h2>
          {analytics.creators.map((creator: any) => (
            <div className="rank-row" key={creator.name}>
              <span>{creator.name}</span>
              <b>{money(creator.creatorRevenue)}</b>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>Category revenue</h2>
          {analytics.categories.map((category: any) => (
            <div className="rank-row" key={category.name}>
              <span>{category.name}</span>
              <b>{money(category.categoryRevenue)}</b>
            </div>
          ))}
        </div>
        <div className="panel wide">
          <h2>Daily sales trend</h2>
          <div className="bars">
            {analytics.daily.map((day: any) => (
              <div key={day.day} className="bar-item">
                <span style={{ height: `${Math.max(16, (day.revenue / maxDaily) * 130)}px` }} />
                <small>{day.day.slice(5)}</small>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric">
      {icon}
      <span>{label}</span>
      <b>{value}</b>
    </article>
  )
}
