import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Icons } from '../components/icons'
import { getAnalyticsFn } from '../server/market'

export const Route = createFileRoute('/creator')({
  loader: () => null,
  component: CreatorPage,
})

function money(value: number) {
  return `$${value.toFixed(2)}`
}

function CreatorPage() {
  const [analytics, setAnalytics] = useState<any>(null)
  useEffect(() => {
    getAnalyticsFn().then(setAnalytics)
  }, [])
  if (!analytics) return <main className="analytics-page">Loading analytics...</main>
  return (
    <main className="analytics-page">
      <Link to="/" className="back-link">
        <Icons.ChevronRight /> Back to storefront
      </Link>
      <p className="mono kicker">Creator admin</p>
      <h1>Sales analytics</h1>
      <section className="metrics">
        <div>
          <span>Gross revenue</span>
          <strong>{money(analytics.summary.grossRevenue)}</strong>
        </div>
        <div>
          <span>Creator revenue</span>
          <strong>{money(analytics.summary.creatorRevenue)}</strong>
        </div>
        <div>
          <span>Conversion rate</span>
          <strong>{analytics.summary.conversionRate}%</strong>
        </div>
        <div>
          <span>Avg order value</span>
          <strong>{money(analytics.summary.averageOrderValue)}</strong>
        </div>
      </section>
      <div className="analytics-grid">
        <section className="table-panel">
          <h2>Creator revenue</h2>
          {analytics.creators.map((creator) => (
            <div className="table-row" key={creator.creator}>
              <span>{creator.creator}</span>
              <span>{creator.sales} sales</span>
              <strong>{money(creator.creatorRevenue)}</strong>
            </div>
          ))}
        </section>
        <section className="table-panel">
          <h2>Category revenue</h2>
          {analytics.categoryRevenue.map((category) => (
            <div className="table-row" key={category.category}>
              <span>{category.category}</span>
              <span>{category.sales} sales</span>
              <strong>{money(category.revenue)}</strong>
            </div>
          ))}
        </section>
        <section className="table-panel trend-panel">
          <h2>Daily sales trend</h2>
          <div className="trend-bars">
            {analytics.dailySales.map((day) => (
              <div key={day.day}>
                <span style={{ height: `${Math.max(18, day.revenue * 2)}px` }} />
                <em>{day.day.slice(5)}</em>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
