import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { checkoutAction, getCartState, removeCartAction } from '../server/functions'
import { money } from '../components/PromptCard'
import { useState } from 'react'

export const Route = createFileRoute('/cart')({
  loader: () => getCartState(),
  component: CartRoute,
})

function CartRoute() {
  const cart = Route.useLoaderData() as any
  const router = useRouter()
  const [notice, setNotice] = useState('')
  return <section className="cart">
    <div className="panel">
      <p className="eyebrow mono">Cart and checkout simulation</p>
      <h1>Cart</h1>
      {cart.items.length ? cart.items.map((item: any) => <div className="cart-row" key={item.id}>
        <img src={item.image} alt="" />
        <div><b>{item.title}</b><p className="desc">{item.model} · {item.creator} · Qty {item.quantity}</p></div>
        <button className="ghost" onClick={async () => { await removeCartAction({ data: item.id }); router.invalidate() }}>Remove</button>
      </div>) : <p>Your Cart is empty. Save a Featured prompt or return to Popular prompts.</p>}
      <div className="totals">
        <div><span>Subtotal</span><b>{money(cart.totals.subtotalCents)}</b></div>
        <div><span>Marketplace fee</span><b>{money(cart.totals.feeCents)}</b></div>
        <div><span>Total</span><b>{money(cart.totals.totalCents)}</b></div>
        <button className="primary" disabled={!cart.items.length} onClick={async () => { const res = await checkoutAction() as any; setNotice(res.ok ? `Checkout complete: ${res.orderId}` : 'Cart is empty'); router.invalidate() }}>Checkout</button>
        <Link className="ghost" to="/">Continue shopping</Link>
      </div>
    </div>
    {notice ? <div role="status" className="toast">{notice}</div> : null}
  </section>
}
