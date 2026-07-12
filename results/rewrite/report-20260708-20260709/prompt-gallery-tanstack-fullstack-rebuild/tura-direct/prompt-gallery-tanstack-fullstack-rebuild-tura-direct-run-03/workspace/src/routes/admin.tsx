import { createFileRoute } from '@tanstack/react-router'
import { Dock, Sidebar } from './__root'
import { fetchAnalytics, fetchCatalog } from '../lib/serverFns'

export const Route = createFileRoute('/admin')({ loader: async () => ({ analytics: await fetchAnalytics(), shell: await fetchCatalog({ data: {} }) }), component: AdminPage })
const money = (c: number) => `$${(Number(c || 0) / 100).toFixed(0)}`
function AdminPage() {
  const { analytics: a, shell } = Route.useLoaderData() as any
  return <div className="app"><Sidebar categories={shell.categories} counts={shell.counts} /><main className="main"><header className="topbar"><section className="hero"><h1>Creator<br />Analytics</h1><p>Revenue, conversion, average order value, category totals, and sales trends are calculated in SQLite queries.</p></section></header><section className="kpis"><div className="kpi"><span>Revenue</span><strong>{money(a.totals.revenue)}</strong></div><div className="kpi"><span>Orders</span><strong>{a.totals.orders}</strong></div><div className="kpi"><span>Average order value</span><strong>{money(a.totals.aov)}</strong></div><div className="kpi"><span>Conversion rate</span><strong>{a.conversion.rate}%</strong></div></section><h2>Creator revenue</h2><table className="table"><tbody>{a.creators.map((r: any) => <tr key={r.name}><td>{r.name}</td><td>{r.sales} sales</td><td>{money(r.revenue)}</td></tr>)}</tbody></table><h2>Category totals</h2><table className="table"><tbody>{a.categories.map((r: any) => <tr key={r.name}><td>{r.name}</td><td>{money(r.revenue)}</td></tr>)}</tbody></table><h2>Daily trend</h2><table className="table"><tbody>{a.trends.map((r: any) => <tr key={r.day}><td>{r.day}</td><td>{r.orders} orders</td><td>{money(r.revenue)}</td></tr>)}</tbody></table></main><Dock /></div>
}
