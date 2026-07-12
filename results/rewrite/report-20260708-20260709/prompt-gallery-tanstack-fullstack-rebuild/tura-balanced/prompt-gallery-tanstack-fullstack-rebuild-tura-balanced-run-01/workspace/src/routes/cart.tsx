import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { AppShell } from '../components/AppShell'
import { Icons } from '../components/icons'
import { useToast } from '../components/toast'
import { checkoutCartFn, getCartFn } from '../server/queries'

export const Route = createFileRoute('/cart')({
  loader: async () => ({ cart: await getCartFn() }),
  component: CartRoute,
})

function CartRoute() {
  const { cart } = Route.useLoaderData()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const checkout = async () => {
    const result = await checkoutCartFn()
    showToast(result.ok ? `Checkout complete: ${result.orderId}` : 'Your cart is empty')
    await navigate({ to: '/cart', replace: true })
  }
  return (
    <AppShell cartCount={cart.totals.itemCount}>
      <div className="cart-page">
        <h1>Cart</h1>
        <section className="panel">
          {cart.items.length === 0 ? <div className="empty"><div className="big">Your cart is empty</div><div>Choose prompts from the gallery to build a checkout.</div></div> : cart.items.map((item) => (
            <div className="cart-row" key={item.id}>
              <div className="cart-main"><img src={item.imageUrl} alt="" /><div><strong>{item.title}</strong><div className="model">{item.model}</div></div></div>
              <span>Qty {item.quantity}</span><strong>${item.lineTotal.toFixed(2)}</strong>
            </div>
          ))}
          <div className="summary">
            <div className="stat-row"><span>Subtotal</span><strong>${cart.totals.subtotal.toFixed(2)}</strong></div>
            <div className="stat-row"><span>Marketplace fee</span><strong>${cart.totals.fee.toFixed(2)}</strong></div>
            <div className="stat-row"><span>Total</span><strong>${cart.totals.total.toFixed(2)}</strong></div>
            <button className="btn-ink" type="button" onClick={() => void checkout()}><Icons.ShoppingBag size={16} /> Checkout simulation</button>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
