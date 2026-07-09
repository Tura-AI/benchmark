import type { getAnalytics } from '@/db/queries'

export function AnalyticsView({ analytics }: { analytics: ReturnType<typeof getAnalytics> }) {
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
  return (
    <section className="analytics">
      <h1>Creator analytics</h1>
      <p className="desc">Revenue, conversion, category totals, and trend summaries are calculated by SQLite queries.</p>
      <div className="stats">
        <div className="stat"><div className="k">Revenue</div><div className="v">{money(analytics.summary.revenueCents)}</div></div>
        <div className="stat"><div className="k">Conversion</div><div className="v">{analytics.summary.conversionRate}%</div></div>
        <div className="stat"><div className="k">Avg order</div><div className="v">{money(analytics.summary.averageOrderCents)}</div></div>
      </div>
      <div className="grid-2">
        <Panel title="Creator revenue" rows={analytics.creatorRevenue.map((r) => [r.creator, money(r.creatorRevenueCents)])} />
        <Panel title="Category revenue" rows={analytics.categoryRevenue.map((r) => [r.category, money(r.revenueCents)])} />
        <Panel title="Daily sales" rows={analytics.dailySales.map((r) => [r.day, `${r.orders} · ${money(r.revenueCents)}`])} />
        <Panel title="Marketplace" rows={[["Orders", String(analytics.summary.orders)], ["Average prompt price", money(analytics.summary.averagePriceCents)]]} />
      </div>
    </section>
  )
}

function Panel({ title, rows }: { title: string; rows: string[][] }) {
  return <div className="panel"><h2>{title}</h2><ul>{rows.map(([a, b]) => <li key={a}><span>{a}</span><strong>{b}</strong></li>)}</ul></div>
}
