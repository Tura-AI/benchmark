import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Toast } from '../components/Toast'
import { checkoutFn, getCatalogFn, getCartFn, removeFromCartFn } from '../server/functions'

export const Route = createFileRoute('/cart')({
  loader: async () => ({ catalog: await getCatalogFn({ data: {} }), cart: await getCartFn() }),
  component: CartRoute,
})

function CartRoute() {
  const router = useRouter()
  const { catalog, cart } = Route.useLoaderData()
  const [toast, setToast] = useState('')
  async function remove(promptId: number) {
    await removeFromCartFn({ data: { promptId } })
    setToast('Removed from Cart')
    await router.invalidate()
  }
  async function checkout() {
    const result = await checkoutFn()
    setToast(result.ok ? 'Checkout complete' : 'Cart is empty')
    await router.invalidate()
  }
  return (
    <div className="app">
      <AppShell categories={catalog.categories} cartCount={cart.totals.itemCount} active="cart" />
      <main className="checkout-main">
        <Link className="back" to="/">Back to gallery</Link>
        <h1>Cart</h1>
        <div className="cart-grid">
          <section className="cart-list">
            {cart.items.length ? cart.items.map((item) => <article className="cart-row" key={item.id}><img src={item.imageUrl} alt="" /><div><b>{item.title}</b><span>{item.model} / {item.category}</span></div><strong>{item.price === 0 ? 'Free' : `$${item.price}`}</strong><button onClick={() => remove(item.id)} type="button">Remove</button></article>) : <p className="empty">Your Cart is empty. Add a prompt from Featured, Newest, or Popular.</p>}
          </section>
          <aside className="summary"><span>Subtotal ${cart.totals.subtotal.toFixed(2)}</span><span>Fees ${cart.totals.fees.toFixed(2)}</span><strong>Total ${cart.totals.total.toFixed(2)}</strong><button className="primary" onClick={checkout} type="button">Checkout simulation</button></aside>
        </div>
      </main>
      <Toast message={toast} />
    </div>
  )
}
