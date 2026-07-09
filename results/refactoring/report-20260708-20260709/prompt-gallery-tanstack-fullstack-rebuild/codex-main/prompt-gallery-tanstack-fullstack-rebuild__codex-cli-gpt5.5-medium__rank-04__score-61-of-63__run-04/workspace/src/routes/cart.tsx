import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { Chrome } from '@/components/Chrome'
import { useToast } from '@/components/useToast'
import { getJson, postJson } from '@/client-api'

export const Route = createFileRoute('/cart')({
  loader: async () => {
    if (typeof window === 'undefined') {
      const { cartApi, storefrontApi } = await import('@/server/api')
      return { cart: cartApi(), categories: storefrontApi().categories }
    }
    return getJson('/api/cart')
  },
  component: CartPage,
})

function CartPage() {
  const { cart, categories } = Route.useLoaderData()
  const router = useRouter()
  const toast = useToast()
  async function remove(promptId: number) {
    await postJson('/api/cart', { action: 'remove', promptId })
    await router.invalidate()
    toast('Removed from cart')
  }
  async function checkout() {
    const result = await postJson<{ ok: boolean; message: string }>('/api/cart', { action: 'checkout' })
    await router.invalidate()
    toast(result.message)
  }
  return (
    <Chrome categories={categories} cartCount={cart.totals.count}>
      <section className="checkout">
        <div className="page-head">
          <div>
            <h1>Cart</h1>
            <p className="desc">Checkout simulation with database-calculated subtotal, fee, and total.</p>
          </div>
          <Link className="secondary" to="/">Keep browsing</Link>
        </div>
        <div className="checkout-grid">
          <div className="cart-list">
            {cart.items.length ? cart.items.map((item) => (
              <article className="cart-item" key={item.id}>
                <img src={item.imageUrl} alt="" />
                <div>
                  <b>{item.title}</b>
                  <div className="desc">{item.model} · {item.category} · {item.creator} · Qty {item.quantity}</div>
                </div>
                <div className="price">
                  ${item.lineTotal.toFixed(2)}
                  <button className="save-btn" aria-label={`Remove ${item.title}`} onClick={() => remove(item.id)}><Trash2 size={15} /></button>
                </div>
              </article>
            )) : <div className="panel">Your cart is empty. Featured, Newest, Popular, Favorites, and Cart are all waiting in the dock.</div>}
          </div>
          <aside className="panel totals">
            <div><span>Subtotal</span><b>${cart.totals.subtotal.toFixed(2)}</b></div>
            <div><span>Marketplace fee</span><b>${cart.totals.fee.toFixed(2)}</b></div>
            <div className="grand"><span>Total</span><b>${cart.totals.total.toFixed(2)}</b></div>
            <button className="primary" disabled={!cart.items.length} onClick={checkout}>Checkout</button>
          </aside>
        </div>
      </section>
    </Chrome>
  )
}
