import { Link } from '@tanstack/react-router'
import type { AnalyticsResult } from '../data/types'
import { Icon } from './Icon'
import { MarketplaceShell } from './MarketplaceShell'

export function AnalyticsPage({ data }: { data: AnalyticsResult }) {
  const maxDay = Math.max(...data.daily.map((d) => d.sales), 1)
  const maxCategory = Math.max(...data.categories.map((d) => d.revenue), 1)
  return <MarketplaceShell>
    <div className="analytics-page">
      <div className="analytics-top"><div><span className="eyebrow">Creator workspace · Last 7 days</span><h1>The numbers, clearly.</h1><p>Sales and discovery across the POWERPROMPT marketplace.</p></div><Link to="/" className="outline-button">View storefront <Icon name="arrow" /></Link></div>
      <section className="metric-grid"><Metric label="Gross revenue" value={`$${data.summary.revenue.toFixed(2)}`} trend="+18.4%"/><Metric label="Creator earnings" value={`$${data.summary.creatorRevenue.toFixed(2)}`} trend="85% share"/><Metric label="Conversion" value={`${data.summary.conversionRate}%`} trend="Views → sales"/><Metric label="Avg. order" value={`$${data.summary.averageOrderValue.toFixed(2)}`} trend={`${data.summary.orders} orders`}/></section>
      <div className="analytics-grid">
        <section className="panel sales-panel"><div className="panel-head"><div><span className="eyebrow">Revenue trend</span><h2>Daily sales</h2></div><span className="live-dot">Live data</span></div><div className="bar-chart" aria-label="Daily sales chart">{data.daily.map((day) => <div className="bar-column" key={day.day}><span className="bar-value">${day.sales}</span><div className="bar" style={{ height: `${Math.max(12, (day.sales / maxDay) * 100)}%` }} /><small>{new Date(`${day.day}T12:00:00Z`).toLocaleDateString('en', { weekday: 'short' })}</small></div>)}</div></section>
        <section className="panel"><div className="panel-head"><div><span className="eyebrow">Performance</span><h2>By category</h2></div></div><div className="category-bars">{data.categories.map((cat) => <div key={cat.name}><div><b>{cat.name}</b><span>${cat.revenue.toFixed(2)} · {cat.units} sold</span></div><i><span style={{ width: `${(cat.revenue / maxCategory) * 100}%` }} /></i></div>)}</div></section>
      </div>
      <div className="analytics-grid lower">
        <section className="panel"><div className="panel-head"><div><span className="eyebrow">Marketplace</span><h2>Top prompts</h2></div></div><div className="top-list">{data.topPrompts.map((p, index) => <div key={p.title}><span className="rank">0{index + 1}</span><img src={p.image} alt=""/><div><b>{p.title}</b><span>{p.model} · {p.units} sold</span></div><strong>${p.revenue.toFixed(2)}</strong></div>)}</div></section>
        <section className="panel"><div className="panel-head"><div><span className="eyebrow">Payout board</span><h2>Creator revenue</h2></div><span className="average-price">Avg prompt ${data.summary.averagePromptPrice}</span></div><div className="creator-table">{data.creators.map((creator) => <div key={creator.handle}><span className="creator-avatar">{creator.name.slice(0, 2).toUpperCase()}</span><div><b>{creator.name}</b><span>{creator.handle} · {creator.prompts} prompts</span></div><strong>${creator.revenue.toFixed(2)}</strong></div>)}</div></section>
      </div>
    </div>
  </MarketplaceShell>
}

function Metric({ label, value, trend }: { label: string; value: string; trend: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{trend}</small></div> }
