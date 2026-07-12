import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { getAnalyticsFn, getCartFn } from '../server/functions'

export const Route = createFileRoute('/analytics')({
  loader: async () => ({ analytics: await getAnalyticsFn(), cart: await getCartFn() }), component: AnalyticsPage,
})
const money = (value: number) => `$${(value/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`
function AnalyticsPage() {
  const { analytics: data, cart } = Route.useLoaderData()
  const overview = data.overview as {grossRevenueCents:number;averageOrderValueCents:number;completedOrders:number;conversionRate:number}
  const maxSales = Math.max(...data.daily.map((d: any) => d.salesCents))
  return <AppShell cartCount={cart.itemCount}>
    <main className="analytics-page">
      <Link to="/" className="back-link"><ArrowLeft />Marketplace</Link>
      <header className="analytics-head"><div><span className="eyebrow">Creator workspace</span><h1>Sales overview</h1><p>Completed orders · July 4–9</p></div><a href="/api/catalog" target="_blank">Open catalog API<ArrowUpRight /></a></header>
      <section className="metric-strip"><div><span>Gross revenue</span><strong>{money(overview.grossRevenueCents)}</strong></div><div><span>Orders</span><strong>{overview.completedOrders}</strong></div><div><span>Conversion</span><strong>{overview.conversionRate}%</strong></div><div><span>Average order</span><strong>{money(overview.averageOrderValueCents)}</strong></div></section>
      <section className="analytics-grid"><article className="trend-panel"><header><div><span className="eyebrow">Daily trend</span><h2>Revenue</h2></div><strong>{money(overview.grossRevenueCents)}</strong></header><div className="bar-chart" aria-label="Daily revenue chart">{data.daily.map((day: any) => <div key={day.day} className="bar-col"><span className="bar-value">{money(day.salesCents)}</span><i style={{height:`${Math.max(4,day.salesCents/maxSales*100)}%`}}/><small>{day.day.slice(5)}</small></div>)}</div></article>
        <article className="category-panel"><span className="eyebrow">Category revenue</span><h2>What buyers choose</h2><ol>{data.categories.map((category: any, i) => <li key={category.name}><span>{String(i+1).padStart(2,'0')} · {category.name}</span><strong>{money(category.revenueCents)}</strong></li>)}</ol></article></section>
      <section className="creator-table"><header><span className="eyebrow">Payout ledger</span><h2>Creator revenue</h2></header><div className="table-scroll"><table><thead><tr><th>Creator</th><th>Orders</th><th>Gross</th><th>Creator share</th></tr></thead><tbody>{data.creators.map((creator: any) => <tr key={creator.name}><td>{creator.name}</td><td>{creator.orders}</td><td>{money(creator.grossCents)}</td><td><strong>{money(creator.revenueCents)}</strong></td></tr>)}</tbody></table></div></section>
    </main>
  </AppShell>
}
