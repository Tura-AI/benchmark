import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { runCheckout, updateCartItem } from '../data/marketplace.functions'
import type { CartResult } from '../data/types'
import { Icon } from './Icon'
import { MarketplaceShell } from './MarketplaceShell'
import { Toast } from './Toast'

export function CartPage({ initial }: { initial: CartResult }) {
  const [cart, setCart] = useState(initial)
  const [toast, setToast] = useState('')
  const [processing, setProcessing] = useState(false)
  const [receipt, setReceipt] = useState<{ reference: string; total: number; items: number } | null>(null)
  const update = async (promptId: number, quantity: number) => { const next = await updateCartItem({ data: { promptId, quantity } }); setCart(next); setToast(quantity <= 0 ? 'Removed from cart' : 'Cart updated'); setTimeout(() => setToast(''), 1800) }
  const checkout = async () => { setProcessing(true); try { const result = await runCheckout(); setReceipt(result); setCart({ items: [], subtotal: 0, fee: 0, total: 0, count: 0 }) } finally { setProcessing(false) } }
  return <MarketplaceShell cartCount={cart.count} onNotice={(m) => setToast(m)}>
    <div className="cart-page">
      <div className="page-heading"><span className="eyebrow">Your collection</span><h1>Cart <sup>{cart.count}</sup></h1><p>One checkout. Lifetime access to every prompt.</p></div>
      {receipt ? <div className="success-card"><span className="success-icon"><Icon name="check" /></span><span className="eyebrow">Order complete</span><h2>Your prompts are ready.</h2><p>Order {receipt.reference} is confirmed. Your {receipt.items} prompt{receipt.items === 1 ? '' : 's'} now live in your library.</p><div><span>Total paid</span><b>${receipt.total.toFixed(2)}</b></div><Link to="/" className="primary-button">Keep exploring <Icon name="arrow" /></Link></div> : cart.items.length ? <div className="cart-layout">
        <div className="cart-items">{cart.items.map((item) => <article className="cart-item" key={item.id}><Link to="/prompts/$slug" params={{ slug: item.slug }} className="cart-thumb" style={{ aspectRatio: item.aspectRatio }}><img src={item.image} alt="" /></Link><div className="cart-item-info"><span className="model-pill">{item.model}</span><Link to="/prompts/$slug" params={{ slug: item.slug }}><h2>{item.title}</h2></Link><p>by {item.creator}</p><div className="quantity-control"><button aria-label="Decrease quantity" onClick={() => update(item.id, item.quantity - 1)}><Icon name="minus" /></button><span>{item.quantity}</span><button aria-label="Increase quantity" onClick={() => update(item.id, item.quantity + 1)}><Icon name="plus" /></button></div></div><div className="cart-item-price"><b>{item.price ? `$${(item.price * item.quantity).toFixed(2)}` : 'Free'}</b><button onClick={() => update(item.id, 0)}>Remove</button></div></article>)}</div>
        <aside className="order-summary"><span className="eyebrow">Order summary</span><h2>Ready when you are.</h2><dl><div><dt>Subtotal</dt><dd>${cart.subtotal.toFixed(2)}</dd></div><div><dt>Service fee</dt><dd>${cart.fee.toFixed(2)}</dd></div><div className="total"><dt>Total</dt><dd>${cart.total.toFixed(2)}</dd></div></dl><button className="checkout-button" disabled={processing} onClick={checkout}>{processing ? 'Processing…' : 'Complete checkout'} <Icon name="arrow" /></button><p>Secure simulated checkout · No payment required</p></aside>
      </div> : <div className="empty-cart"><span><Icon name="cart" /></span><h2>Your cart is feeling light.</h2><p>Explore the gallery and collect prompts built by expert creators.</p><Link to="/" className="primary-button">Browse the gallery <Icon name="arrow" /></Link></div>}
    </div><Toast message={toast} />
  </MarketplaceShell>
}
