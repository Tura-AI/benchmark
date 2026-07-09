import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Icons } from '../components/icons'
import { Toast } from '../components/Toast'
import type { Toast as ToastType } from '../components/types'
import { checkoutFn, getCartFn, removeFromCartFn } from '../server/market'

export const Route = createFileRoute('/cart')({
  loader: () => ({
    items: [],
    totals: { subtotal: 0, platformFee: 0, total: 0, paidCount: 0, freeCount: 0 },
  }),
  component: CartPage,
})

function CartPage() {
  const initial = Route.useLoaderData()
  const [cart, setCart] = useState<any>(initial)
  const [toast, setToast] = useState<ToastType | null>(null)

  useEffect(() => {
    getCartFn().then(setCart)
  }, [])

  return (
    <main className="checkout-page">
      <Link to="/" className="back-link">
        <Icons.ChevronRight /> Continue shopping
      </Link>
      <div className="checkout-grid">
        <section>
          <p className="mono kicker">Cart</p>
          <h1>Cart and checkout</h1>
          <div className="cart-list">
            {cart.items.length ? (
              cart.items.map((item) => (
                <article className="cart-item" key={item.id}>
                  <img src={item.image} alt={item.title} />
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.model} · {item.creator} · Qty {item.quantity}</p>
                  </div>
                  <strong>{item.price === 0 ? 'Free' : `$${item.lineTotal.toFixed(2)}`}</strong>
                  <button
                    className="icon-btn"
                    aria-label={`Remove ${item.title}`}
                    onClick={async () => {
                      setCart(await removeFromCartFn({ data: { promptId: item.id } }))
                      setToast({ text: 'Removed from Cart' })
                    }}
                  >
                    <Icons.X />
                  </button>
                </article>
              ))
            ) : (
              <div className="empty small">
                <div className="big">Your Cart is empty</div>
                <p>Favorites and Featured prompts are waiting in the gallery.</p>
              </div>
            )}
          </div>
        </section>
        <aside className="summary-panel">
          <h2>Order summary</h2>
          <div className="summary-row">
            <span>Subtotal</span>
            <strong>${cart.totals.subtotal.toFixed(2)}</strong>
          </div>
          <div className="summary-row">
            <span>Marketplace fee</span>
            <strong>${cart.totals.platformFee.toFixed(2)}</strong>
          </div>
          <div className="summary-row total">
            <span>Total</span>
            <strong>${cart.totals.total.toFixed(2)}</strong>
          </div>
          <button
            className="checkout-btn"
            disabled={!cart.items.length}
            onClick={async () => {
              const result = await checkoutFn()
              setCart(result.cart)
              setToast({ text: result.ok ? `Checkout complete: order #${result.orderId}` : 'Cart is empty' })
            }}
          >
            Simulate checkout
          </button>
        </aside>
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </main>
  )
}
