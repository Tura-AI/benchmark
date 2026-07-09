import { createFileRoute, Link } from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'
import { getAnalyticsFn, getCatalogFn } from '../server/functions'

export const Route = createFileRoute('/admin')({
  loader: async () => ({ catalog: await getCatalogFn({ data: {} }), analytics: await getAnalyticsFn() }),
  component: AdminRoute,
})

function AdminRoute() {
  const { catalog, analytics } = Route.useLoaderData()
  return (
    <div className="app">
      <AppShell categories={catalog.categories} cartCount={catalog.cart.totals.itemCount} active="admin" />
      <main className="admin-main">
        <Link className="back" to="/">Back to gallery</Link>
        <h1>Creator analytics</h1>
        <section className="metric-strip"><b>${analytics.totals.revenue.toFixed(2)}</b><span>{analytics.totals.orders} orders</span><span>{Math.round(analytics.totals.conversionRate * 100)}% conversion</span><span>${analytics.totals.averageOrderValue.toFixed(2)} AOV</span></section>
        <section className="admin-grid">
          <Panel title="Creator revenue">{analytics.creatorRevenue.map((row) => <div className="line" key={row.creator}><span>{row.creator}</span><b>${row.revenue.toFixed(2)}</b><em>{row.sales} sales / {Math.round(row.conversionRate * 100)}%</em></div>)}</Panel>
          <Panel title="Category revenue">{analytics.categoryRevenue.map((row) => <div className="line" key={row.category}><span>{row.category}</span><b>${row.revenue.toFixed(2)}</b><em>{row.sales} sales</em></div>)}</Panel>
          <Panel title="Daily sales trend">{analytics.dailySales.map((row) => <div className="line" key={row.day}><span>{row.day}</span><b>${row.revenue.toFixed(2)}</b><em>{row.orders} orders</em></div>)}</Panel>
        </section>
      </main>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="panel"><h2>{title}</h2>{children}</article>
}
