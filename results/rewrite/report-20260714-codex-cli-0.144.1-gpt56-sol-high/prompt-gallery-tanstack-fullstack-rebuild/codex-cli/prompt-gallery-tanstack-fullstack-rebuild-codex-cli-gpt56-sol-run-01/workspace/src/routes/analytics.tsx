import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icons'
import { getAnalyticsData } from '../server/marketplace.server'

export const Route = createFileRoute('/analytics')({loader:()=>getAnalyticsData(),component:AnalyticsPage})

function AnalyticsPage(){
  const data=Route.useLoaderData()
  const max=Math.max(...data.daily.map((d:any)=>d.revenue),1)
  return <AppShell><main className="analytics-page"><div className="analytics-head"><div><p className="eyebrow">Creator command center</p><h1>Marketplace pulse<span>.</span></h1><p>Revenue, conversion, and category demand — calculated from local order data.</p></div><button className="button button--lime">Publish a prompt <Icon name="arrow"/></button></div>
    <section className="metrics"><Metric label="Gross revenue" value={`$${data.overview.grossRevenue.toFixed(2)}`} change="+18.4%"/><Metric label="Paid orders" value={String(data.overview.orders)} change="+6 this week"/><Metric label="Average order" value={`$${data.overview.averageOrderValue.toFixed(2)}`} change="SQL-calculated"/><Metric label="Conversion" value={`${data.overview.conversionRate.toFixed(2)}%`} change="Across catalog"/></section>
    <section className="analytics-grid"><article className="panel sales-panel"><div className="panel-title"><div><p className="eyebrow">Daily sales</p><h2>Revenue trend</h2></div><span>Jul 01 — Jul 14</span></div><div className="chart-bars">{data.daily.map((d:any)=><div key={d.day}><span style={{height:`${Math.max(d.revenue/max*100,3)}%`}} title={`$${d.revenue}`} /><small>{d.day.slice(-2)}</small></div>)}</div></article>
      <article className="panel"><div className="panel-title"><div><p className="eyebrow">Leaderboard</p><h2>Top creators</h2></div></div><div className="data-list creators-list">{data.creators.slice(0,5).map((c:any,i:number)=><div key={c.id}><span className="rank">0{i+1}</span><strong>{c.name}<small>{c.prompts} prompt{c.prompts===1?'':'s'} · {c.conversionRate}% conv.</small></strong><b>${c.revenue.toFixed(2)}</b></div>)}</div></article>
      <article className="panel category-panel"><div className="panel-title"><div><p className="eyebrow">Demand</p><h2>Category revenue</h2></div></div><div className="data-list">{data.categories.map((c:any)=><div key={c.name}><strong>{c.name}<small>{c.prompts} prompts · {c.sales} orders</small></strong><b>${c.revenue.toFixed(2)}</b></div>)}</div></article>
      <article className="panel creator-note"><Icon name="spark"/><p className="eyebrow">Creator program</p><h2>You make the good stuff. Keep 85%.</h2><p>Publish once, earn on every sale, and use clear demand signals to decide what to make next.</p><button className="text-link">Read creator guide <Icon name="arrow"/></button></article>
    </section>
  </main></AppShell>
}

function Metric({label,value,change}:{label:string;value:string;change:string}){return <article><p>{label}</p><strong>{value}</strong><span>{change}</span></article>}
