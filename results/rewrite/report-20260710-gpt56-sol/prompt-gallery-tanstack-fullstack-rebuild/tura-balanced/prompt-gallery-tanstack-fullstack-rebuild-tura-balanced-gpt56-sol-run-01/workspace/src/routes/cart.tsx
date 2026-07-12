import { createFileRoute } from '@tanstack/react-router'
import { CartPage } from '~/components/CartPage'
import { getCart } from '~/server/marketplace.functions'

export const Route = createFileRoute('/cart')({ loader: () => getCart(), component: CartRoute })

function CartRoute() {
  return <CartPage initial={Route.useLoaderData()} />
}
