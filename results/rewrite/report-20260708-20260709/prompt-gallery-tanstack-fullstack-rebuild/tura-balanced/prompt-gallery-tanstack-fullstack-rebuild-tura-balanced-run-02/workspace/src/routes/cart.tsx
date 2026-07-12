import { createFileRoute } from '@tanstack/react-router'
import { CartView } from '@/components/cart'
import { Shell } from '@/components/layout'
import { getCartState, getStorefront } from '@/server/marketplace'

export const Route = createFileRoute('/cart')({
  loader: async () => {
    const [cart, shell] = await Promise.all([getCartState(), getStorefront({ data: {} })])
    return { cart, shell }
  },
  component: CartRoute,
})

function CartRoute() {
  const data = Route.useLoaderData()
  return <Shell categories={data.shell.categories} cartCount={data.cart.count}><CartView cart={data.cart} /></Shell>
}
