import { Link, createFileRoute } from '@tanstack/react-router'
import { fetchAnalytics } from '~/data/server'

export const Route = createFileRoute('/admin')({ loader: () => fetchAnalytics(), component: Admin })

function money(cents: number) { return `$${(Number(cents) / 100).toFixed(0)}` }
function Admin() {
  const a: any = Route.useLoaderData()
  return <main className="admin"><Link to="/" search={{ category: 'All' }} className="back">POWERPROMPT</Link><p className="mono">Creator analytics</p><h1>Revenue, conversion, and prompt sales</h1><section className="metrics"><article><span>Revenue</span><b>{money(a.summary.revenueCents)}</b></article><article><span>Conversion</span><b>{a.summary.conversionRate}%</b></article><article><span>Average order value</span><b>{money(a.summary.averageOrderValueCents)}</b></article></section><div className="analytics-grid"><section><h2>Creator revenue</h2>{a.creatorRevenue.map((r: any) => <p key={r.creator}><span>{r.creator}</span><b>{money(r.revenueCents)}</b></p>)}</section><section><h2>Category revenue</h2>{a.categoryRevenue.map((r: any) => <p key={r.category}><span>{r.category}</span><b>{money(r.revenueCents)}</b></p>)}</section><section><h2>Daily trend</h2>{a.daily.map((r: any) => <p key={r.day}><span>{r.day}</span><b>{money(r.revenueCents)} / {r.conversionRate}%</b></p>)}</section></div></main>
}
