import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, Check, ShoppingBag, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { checkoutFn, getCartFn, removeCartFn } from '../server/functions'

export const Route = createFileRoute('/cart')({ loader: () => getCartFn(), component: CartPage })
const money = (cents: number) => `$${(cents/100).toFixed(2)}`
function CartPage() {
  const cart = Route.useLoaderData()
  const router = useRouter()
  const [receipt, setReceipt] = useState<{id:string;totalCents:number;itemCount:number} | null>(null)
  const remove = async (id: string) => { await removeCartFn({ data: { promptId: id } }); await router.invalidate() }
  const checkout = async () => { const result = await checkoutFn(); setReceipt(result); await router.invalidate() }
  return <AppShell cartCount={cart.itemCount}>
    <main className="cart-page">
      <Link to="/" className="back-link"><ArrowLeft />Continue browsing</Link>
      {receipt ? <section className="receipt"><span><Check /></span><p className="eyebrow">Order confirmed</p><h1>Your prompts are ready.</h1><p>Receipt {receipt.id} · {receipt.itemCount} item{receipt.itemCount > 1 ? 's' : ''} · {money(receipt.totalCents)}</p><Link to="/">Explore more prompts<ArrowRight /></Link></section> : <>
        <header className="page-title"><span className="eyebrow">Checkout</span><h1>Cart</h1><p>{cart.itemCount} prompt{cart.itemCount === 1 ? '' : 's'} selected</p></header>
        {cart.items.length ? <div className="checkout-grid"><section className="cart-lines">{cart.items.map((item) => <article key={item.id}><img src={item.image} alt=""/><div><span>{item.model} · {item.category}</span><h2>{item.title}</h2><p>{item.creatorName} · Qty {item.quantity}</p></div><strong>{money(item.lineTotalCents)}</strong><button onClick={() => remove(item.id)} aria-label={`Remove ${item.title}`}><Trash2 /></button></article>)}</section>
          <aside className="order-summary"><h2>Order summary</h2><dl><div><dt>Subtotal</dt><dd>{money(cart.subtotalCents)}</dd></div><div><dt>Service fee</dt><dd>{money(cart.feeCents)}</dd></div><div className="total"><dt>Total</dt><dd>{money(cart.totalCents)}</dd></div></dl><button onClick={checkout}>Complete order<ArrowRight /></button><small>Secure checkout simulation. No payment details required.</small></aside></div>
          : <section className="empty-cart"><ShoppingBag /><h1>Your cart is empty</h1><p>Build a practical prompt kit from the gallery.</p><Link to="/">Browse prompts</Link></section>}
      </>}
    </main>
  </AppShell>
}
