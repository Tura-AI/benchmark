import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icons'
import { Toast } from '../components/Toast'
import { checkoutCart, getCartData, uncartPrompt } from '../server/marketplace.server'

export const Route = createFileRoute('/cart')({ loader: () => getCartData(), component: CartPage })

function CartPage() {
  const initial = Route.useLoaderData()
  const [cart,setCart] = useState(initial)
  const [notice,setNotice] = useState('')
  const [working,setWorking] = useState(false)
  const [order,setOrder] = useState<number|null>(null)
  const router=useRouter()
  const remove=async(id:number)=>{setCart(await uncartPrompt({data:{promptId:id}}));setNotice('Removed from Cart');window.setTimeout(()=>setNotice(''),2000)}
  const checkout=async()=>{setWorking(true);try{const result=await checkoutCart();setOrder(result.orderId);setCart({...cart,items:[],subtotal:0,fee:0,total:0,count:0});router.invalidate()}finally{setWorking(false)}}
  return <AppShell cartCount={cart.count} onNotice={setNotice}>
    <main className="cart-page"><div className="page-title"><p className="eyebrow">Secure checkout</p><h1>{order?'Order confirmed':'Your Cart'}<span>.</span></h1></div>
      {order ? <div className="success-card"><span><Icon name="check"/></span><p className="eyebrow">Order PP-{String(order).padStart(5,'0')}</p><h2>Your prompts are ready.</h2><p>A receipt and prompt access have been added to your library.</p><Link to="/" className="button button--dark">Keep exploring</Link></div> : cart.items.length ? <div className="cart-layout"><section className="cart-items">{cart.items.map(item=><article className="cart-item" key={item.id}><img src={item.imageUrl} alt=""/><div><span>{item.model} · {item.category}</span><Link to="/prompts/$promptId" params={{promptId:item.slug}}>{item.title}</Link><small>by {item.seller}</small></div><strong>{item.price===0?'Free':`$${item.price.toFixed(2)}`}</strong><button onClick={()=>remove(item.id)} aria-label={`Remove ${item.title}`}><Icon name="trash"/></button></article>)}</section>
        <aside className="summary-card"><h2>Order summary</h2><div><span>Prompts ({cart.count})</span><strong>${cart.subtotal.toFixed(2)}</strong></div><div><span>Platform fee</span><strong>${cart.fee.toFixed(2)}</strong></div><div className="summary-total"><span>Total</span><strong>${cart.total.toFixed(2)}</strong></div><button className="button button--lime" disabled={working} onClick={checkout}>{working?'Processing…':'Complete purchase'} <Icon name="arrow"/></button><p><Icon name="check"/>Encrypted, simulated checkout</p></aside></div> : <div className="empty-state"><Icon name="cart"/><h2>Your cart is taking a breather</h2><p>Pick a prompt from the gallery and it will show up here.</p><Link to="/" className="button button--dark">Explore prompts</Link></div>}
    </main><Toast message={notice}/>
  </AppShell>
}
