import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Icon } from '../components/Icons'
import { apiUrl } from '../utils/api-url'

export const Route = createFileRoute('/cart')({
  loader: async () => {
    const res = await fetch(apiUrl('/api/cart'))
    return res.json()
  },
  component: CartPage,
})

function CartPage() {
  const router = useRouter()
  const cart = Route.useLoaderData()

  async function remove(promptId: number) {
    await fetch('/api/cart', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'remove', promptId }),
    })
    router.invalidate()
  }

  async function checkout() {
    await fetch('/api/checkout', { method: 'POST' })
    router.invalidate()
  }

  return (
    <main className="cart-page">
      <Link to="/" className="backlink">POWERPROMPT Gallery</Link>
      <section className="cart-layout">
        <div>
          <div className="page-kicker">Cart</div>
          <h1>Prompt checkout</h1>
          <div className="cart-list">
            {cart.items.length === 0 ? <p className="muted">Your cart is empty. The storefront is ready when you are.</p> : cart.items.map((item) => (
              <article className="cart-row" key={item.id}>
                <img src={item.imageUrl} alt="" />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.model} · {item.category} · Qty {item.quantity}</span>
                </div>
                <b>{item.lineTotal === 0 ? 'Free' : `$${item.lineTotal.toFixed(2)}`}</b>
                <button aria-label={`Remove ${item.title}`} onClick={() => remove(item.id)}><Icon name="close" /></button>
              </article>
            ))}
          </div>
        </div>
        <aside className="summary-card">
          <span className="mono">Order summary</span>
          <div><span>Subtotal</span><b>${cart.subtotal.toFixed(2)}</b></div>
          <div><span>Creator platform fee</span><b>${cart.fees.toFixed(2)}</b></div>
          <div className="total"><span>Total</span><b>${cart.total.toFixed(2)}</b></div>
          <button className="btn-ink" disabled={cart.items.length === 0} onClick={checkout}>Simulate checkout</button>
        </aside>
      </section>
    </main>
  )
}
