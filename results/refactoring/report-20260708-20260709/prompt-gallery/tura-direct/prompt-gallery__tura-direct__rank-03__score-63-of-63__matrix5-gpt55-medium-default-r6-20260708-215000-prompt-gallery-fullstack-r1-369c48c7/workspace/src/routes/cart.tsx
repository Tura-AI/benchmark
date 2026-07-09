import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Dock, Sidebar } from './__root'
import { fetchCart, fetchCatalog, runCheckout } from '../lib/serverFns'

export const Route = createFileRoute('/cart')({ loader: async () => ({ cart: await fetchCart(), shell: await fetchCatalog({ data: {} }) }), component: CartPage })
const money = (c: number) => `$${(c / 100).toFixed(2)}`
function CartPage() {
  const { cart, shell } = Route.useLoaderData() as any
  const router = useRouter()
  return <div className="app"><Sidebar categories={shell.categories} counts={shell.counts} /><main className="main"><header className="topbar"><section className="hero"><h1>Cart</h1><p>Checkout simulation uses the local database subtotal, marketplace fee, and total calculations.</p></section></header><section className="panel">{cart.items.length ? <><div className="cart-list">{cart.items.map((i: any) => <div className="row" key={i.id}><span>{i.title}<br /><small>{i.creator} × {i.qty}</small></span><strong>{money(i.price_cents * i.qty)}</strong></div>)}</div><div className="row"><span>Subtotal</span><strong>{money(cart.subtotal)}</strong></div><div className="row"><span>Marketplace fee</span><strong>{money(cart.fee)}</strong></div><div className="row"><span>Total</span><strong>{money(cart.total)}</strong></div><button className="lime" onClick={async () => { await runCheckout(); await router.invalidate() }}>Complete checkout</button></> : <div className="empty">Your Cart is empty.</div>}</section></main><Dock /></div>
}
