import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CheckCircle2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Price } from '../components/icons'
import { useToast } from '../components/Toast'
import { api, checkoutServer, removeFromCartServer } from '../market-api'
import type { PromptCard } from '../types'

export const Route = createFileRoute('/cart')({
  loader: () => api.cart(),
  component: CartPage,
})

function CartPage() {
  const cart = Route.useLoaderData() as { items: PromptCard[]; totals: { subtotal: number; platformFee: number; total: number; itemCount: number } }
  const router = useRouter()
  const { showToast } = useToast()
  const [paid, setPaid] = useState<number | null>(null)

  return (
    <div className="commerce-page">
      <header className="page-head">
        <p className="mono">Cart</p>
        <h1>Review your POWERPROMPT stack</h1>
      </header>

      <section className="checkout-grid">
        <div className="cart-list">
          {cart.items.length ? (
            cart.items.map((item) => (
              <article key={item.id} className="line-item">
                <img src={`https://picsum.photos/seed/${item.imageSeed}/220/180`} alt="" />
                <div>
                  <p className="model-pill">{item.model}</p>
                  <h3>{item.title}</h3>
                  <p>{item.category} · {item.creator}</p>
                </div>
                <Price price={item.price} />
                <button
                  className="icon-button"
                  aria-label={`Remove ${item.title}`}
                  onClick={async () => {
                    await removeFromCartServer({ data: item.id })
                    showToast('Removed from cart')
                    router.invalidate()
                  }}
                >
                  <Trash2 />
                </button>
              </article>
            ))
          ) : (
            <div className="empty compact">
              <div className="big">Your cart is empty</div>
              <div>Browse the gallery and add a paid or free prompt.</div>
            </div>
          )}
        </div>

        <aside className="summary-panel">
          <h2>Checkout simulation</h2>
          <div className="sum-row"><span>Items</span><b>{cart.totals.itemCount}</b></div>
          <div className="sum-row"><span>Subtotal</span><b>${cart.totals.subtotal}</b></div>
          <div className="sum-row"><span>Platform fee</span><b>${cart.totals.platformFee}</b></div>
          <div className="sum-row total"><span>Total</span><b>${cart.totals.total}</b></div>
          <button
            className="checkout-btn"
            disabled={!cart.items.length}
            onClick={async () => {
              const result = await checkoutServer()
              if (result.ok) {
                setPaid(result.orderId)
                showToast(`Order #${result.orderId} paid`)
              }
              router.invalidate()
            }}
          >
            <CheckCircle2 /> Complete checkout
          </button>
          {paid && <p className="success-note">Order #{paid} is recorded in analytics.</p>}
        </aside>
      </section>
    </div>
  )
}
