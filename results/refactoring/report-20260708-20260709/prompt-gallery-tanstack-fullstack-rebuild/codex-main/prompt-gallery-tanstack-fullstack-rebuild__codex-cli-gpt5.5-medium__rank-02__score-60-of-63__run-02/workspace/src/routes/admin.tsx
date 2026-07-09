import { createFileRoute, Link } from '@tanstack/react-router'
import { apiUrl } from '../utils/api-url'

export const Route = createFileRoute('/admin')({
  loader: async () => {
    const res = await fetch(apiUrl('/api/admin'))
    return res.json()
  },
  component: AdminPage,
})

function AdminPage() {
  const analytics = Route.useLoaderData()
  return (
    <main className="admin-page">
      <Link to="/" className="backlink">POWERPROMPT Gallery</Link>
      <div className="page-kicker">Creator analytics</div>
      <h1>Marketplace pulse</h1>
      <section className="metric-grid">
        <Metric label="Revenue" value={`$${analytics.summary.revenue.toFixed(2)}`} />
        <Metric label="Orders" value={analytics.summary.orders.toString()} />
        <Metric label="Average order" value={`$${analytics.summary.averageOrderValue.toFixed(2)}`} />
        <Metric label="Conversion" value={`${(analytics.summary.conversionRate * 100).toFixed(2)}%`} />
      </section>
      <section className="analytics-grid">
        <Panel title="Creator revenue">
          {analytics.creatorRevenue.map((row) => (
            <div className="data-row" key={row.creator}><span>{row.creator}</span><b>${row.revenue.toFixed(2)}</b><em>{(row.conversionRate * 100).toFixed(2)}%</em></div>
          ))}
        </Panel>
        <Panel title="Category totals">
          {analytics.categoryRevenue.map((row) => (
            <div className="data-row" key={row.category}><span>{row.category}</span><b>${row.revenue.toFixed(2)}</b><em>{row.units} units</em></div>
          ))}
        </Panel>
        <Panel title="Daily sales trend">
          <div className="trend">
            {analytics.dailySales.map((row) => (
              <div key={row.day} style={{ ['--h' as string]: `${Math.max(12, row.revenue * 2.2)}px` }}><span /> <small>{row.day.slice(5)}</small></div>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="metric"><span className="mono">{label}</span><strong>{value}</strong></article>
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="panel"><h2>{title}</h2>{children}</article>
}
