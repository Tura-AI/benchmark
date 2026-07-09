import { Link } from '@tanstack/react-router'
import { useState, useTransition } from 'react'
import { cartRemove, checkoutCart } from '~/data/server'
import type { CartSummary } from '~/data/schema'

function money(cents: number) { return `$${(cents / 100).toFixed(2)}` }

export function CartPage({ initialCart }: { initialCart: CartSummary }) {
  const [cart, setCart] = useState(initialCart)
  const [order, setOrder] = useState<number | null>(null)
  const [, start] = useTransition()
  return <main className="checkout"><Link to="/" search={{ category: 'All' }} className="back">POWERPROMPT</Link><h1>Cart</h1>{cart.items.length ? <div className="cart-grid"><section>{cart.items.map((item) => <article className="cart-row" key={item.id}><img src={item.image} alt="" /><div><h2>{item.title}</h2><p>{item.model} / {item.category}</p></div><strong>{item.priceCents ? money(item.priceCents) : 'Free'}</strong><button onClick={() => start(async () => setCart(await cartRemove({ data: { promptId: item.id } })))}>Remove</button></article>)}</section><aside><p>Subtotal <b>{money(cart.subtotalCents)}</b></p><p>Marketplace fee <b>{money(cart.feesCents)}</b></p><p>Total <b>{money(cart.totalCents)}</b></p><p>{cart.freeCount} free / {cart.paidCount} paid</p><button className="btn-ink" onClick={() => start(async () => { const result = await checkoutCart(); setCart(result.cart); setOrder(result.orderId) })}>Checkout simulation</button></aside></div> : <p className="lede">Your Cart is empty.</p>}{order ? <p className="status">Order #{order} created and cart cleared.</p> : null}</main>
}
