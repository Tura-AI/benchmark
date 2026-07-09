import { createFileRoute, useRouter } from '@tanstack/react-router'
import { checkoutCart, loadCart, removePromptFromCart } from '~/data/server'
import { FormatMoney } from '~/ui/FormatMoney'

export const Route = createFileRoute('/cart')({
  loader: () => loadCart(),
  component: CartPage,
})

function CartPage() {
  const cart = Route.useLoaderData()
  const router = useRouter()

  async function remove(promptId: number) {
    await removePromptFromCart({ data: { promptId } })
    await router.invalidate()
  }

  async function checkout() {
    if (!cart.count) return
    await checkoutCart()
    await router.invalidate()
  }

  return (
    <main className="cart-page">
      <a className="back-link" href="/">POWERPROMPT Gallery</a>
      <section className="cart-panel">
        <h1>Cart</h1>
        {cart.items.length ? cart.items.map((item) => (
          <article className="cart-row" key={item.id}>
            <img src={item.image} alt="" />
            <div>
              <h2>{item.title}</h2>
              <p>{item.model} / {item.category}</p>
            </div>
            <strong><FormatMoney value={item.lineTotal} /></strong>
            <button onClick={() => remove(item.id)}>Remove</button>
          </article>
        )) : <p className="empty-copy">Your cart is empty.</p>}
        <div className="cart-totals">
          <span>Subtotal <b><FormatMoney value={cart.subtotal} /></b></span>
          <span>Platform fee <b><FormatMoney value={cart.fee} /></b></span>
          <span>Total <b><FormatMoney value={cart.total} /></b></span>
        </div>
        <button className="checkout" onClick={checkout} disabled={!cart.count}>Checkout simulation</button>
      </section>
    </main>
  )
}
