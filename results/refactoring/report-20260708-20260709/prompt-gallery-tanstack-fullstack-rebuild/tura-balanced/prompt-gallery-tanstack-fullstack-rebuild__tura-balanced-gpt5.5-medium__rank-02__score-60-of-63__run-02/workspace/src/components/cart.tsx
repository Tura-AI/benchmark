"use client"

import { useRouter } from '@tanstack/react-router'
import type { getCart } from '@/db/queries'
import { checkoutAction, removeCartAction } from '@/server/marketplace'

export function CartView({ cart }: { cart: ReturnType<typeof getCart> }) {
  const router = useRouter()
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
  return (
    <section className="checkout">
      <h1>Cart</h1>
      {cart.items.length === 0 ? <p className="desc">Your cart is empty. Add a prompt from the gallery to start checkout.</p> : (
        <>
          <div className="list">
            {cart.items.map((item) => (
              <div className="line-item" key={item.id}>
                <img src={item.imageUrl} alt="" />
                <div><strong>{item.title}</strong><div className="k">{item.model} · {item.category} · Qty {item.quantity}</div></div>
                <div><strong>{money(item.lineTotalCents)}</strong><br /><button onClick={async () => { await removeCartAction({ data: { promptId: item.id } }); router.invalidate() }}>Remove</button></div>
              </div>
            ))}
          </div>
          <div className="total-row"><span>Subtotal</span><span>{money(cart.subtotalCents)}</span></div>
          <div className="total-row"><span>Marketplace fee</span><span>{money(cart.feeCents)}</span></div>
          <div className="total-row final"><span>Total</span><span>{money(cart.totalCents)}</span></div>
          <button className="btn-ink" onClick={async () => { await checkoutAction(); router.invalidate() }}>Simulate checkout</button>
        </>
      )}
    </section>
  )
}
