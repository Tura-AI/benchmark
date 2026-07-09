import { createFileRoute } from '@tanstack/react-router'
import { Chrome } from '@/components/Chrome'
import { getJson } from '@/client-api'

export const Route = createFileRoute('/admin')({
  loader: async () => {
    if (typeof window === 'undefined') {
      const { analyticsApi, storefrontApi } = await import('@/server/api')
      const shell = storefrontApi()
      return { analytics: analyticsApi(), categories: shell.categories, cart: shell.cart }
    }
    return getJson('/api/analytics')
  },
  component: AdminPage,
})

function AdminPage() {
  const { analytics, categories, cart } = Route.useLoaderData()
  return (
    <Chrome categories={categories} cartCount={cart.totals.count}>
      <section className="admin">
        <div className="page-head">
          <div>
            <h1>Creator analytics</h1>
            <p className="desc">Revenue, conversion, category totals, and daily sales are queried from SQLite.</p>
          </div>
        </div>
        <div className="admin-grid">
          <Metric label="Gross revenue" value={`$${analytics.summary.grossRevenue.toFixed(2)}`} />
          <Metric label="Orders" value={String(analytics.summary.orders)} />
          <Metric label="Conversion" value={`${analytics.summary.conversionRate}%`} />
          <Metric label="Average order value" value={`$${analytics.summary.averageOrderValue.toFixed(2)}`} />
        </div>
        <div className="two-col">
          <Table title="Creator revenue" rows={analytics.creators} columns={['name', 'units', 'creatorRevenue']} money="creatorRevenue" />
          <Table title="Category revenue" rows={analytics.categories} columns={['name', 'units', 'revenue']} money="revenue" />
        </div>
        <div className="two-col">
          <Table title="Daily sales" rows={analytics.daily} columns={['day', 'orders', 'revenue']} money="revenue" />
          <Table title="Model mix" rows={analytics.modelMix} columns={['model', 'units', 'revenue']} money="revenue" />
        </div>
      </section>
    </Chrome>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span className="side-label" style={{ padding: 0, margin: 0 }}>{label}</span><b>{value}</b></div>
}

function Table<T extends Record<string, string | number>>({
  title,
  rows,
  columns,
  money,
}: {
  title: string
  rows: T[]
  columns: Array<keyof T & string>
  money: keyof T & string
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <table className="table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => <td key={column}>{column === money ? `$${Number(row[column]).toFixed(2)}` : row[column]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
