import { ArrowLeft, ArrowRight, Check, ShoppingBag, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { CartSummary } from '~/contracts'
import { checkoutCart, removePromptFromCart } from '~/server/marketplace.functions'
import { AppShell } from './AppShell'

export function CartPage({ initial }: { initial: CartSummary }) {
  const [cart, setCart] = useState(initial)
  const [email, setEmail] = useState('collector@example.com')
  const [orderId, setOrderId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const remove = async (promptId: number) => setCart(await removePromptFromCart({ data: { promptId } }))
  const checkout = async (event: React.FormEvent) => { event.preventDefault(); setError(''); try { const result = await checkoutCart({ data: { email } }); setOrderId(result.orderId); setCart({ items: [], itemCount: 0, subtotal: 0, serviceFee: 0, total: 0 }) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Checkout failed') } }
  return <AppShell cartCount={cart.itemCount}><main className="commerce-page"><a className="back-link" href="/"><ArrowLeft />Continue browsing</a><header><p className="eyebrow"><span />Cart</p><h1>Your prompt stack</h1><p>One license per prompt. Download access appears immediately after checkout.</p></header>
    {orderId ? <section className="order-success"><Check /><p>Order confirmed</p><h2>Everything is ready.</h2><span>Order PP-{String(orderId).padStart(5, '0')} · Receipt sent to {email}</span><a className="buy-button" href="/">Return to gallery<ArrowRight /></a></section> : cart.items.length ? <div className="cart-layout"><section className="cart-items" aria-label="Cart items">{cart.items.map((item) => <article key={item.id}><img src={item.image} alt="" /><div><span>{item.model} · {item.category}</span><h2>{item.title}</h2><p>by {item.creator}</p></div><strong>{item.price === 0 ? 'Free' : `$${item.lineTotal.toFixed(2)}`}</strong><button onClick={() => void remove(item.id)} aria-label={`Remove ${item.title}`}><Trash2 /></button></article>)}</section>
      <form className="order-summary" onSubmit={checkout}><p className="eyebrow"><span />Summary</p><label>Email for receipt<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><dl><div><dt>Subtotal</dt><dd>${cart.subtotal.toFixed(2)}</dd></div><div><dt>Service fee</dt><dd>${cart.serviceFee.toFixed(2)}</dd></div><div className="total"><dt>Total</dt><dd>${cart.total.toFixed(2)}</dd></div></dl>{error && <p className="form-error">{error}</p>}<button className="buy-button" type="submit">Complete checkout<ArrowRight /></button><small>Secure local checkout simulation. No payment is collected.</small></form></div> : <section className="empty-cart"><ShoppingBag /><h2>Your cart is empty</h2><p>The gallery has paid and free prompts ready to collect.</p><a className="buy-button" href="/">Browse prompts<ArrowRight /></a></section>}
  </main></AppShell>
}
