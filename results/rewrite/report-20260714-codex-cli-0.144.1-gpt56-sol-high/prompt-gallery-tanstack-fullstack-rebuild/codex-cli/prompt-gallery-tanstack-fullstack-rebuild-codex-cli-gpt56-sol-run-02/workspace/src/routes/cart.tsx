import { createFileRoute } from '@tanstack/react-router'
import { CartPage } from '../components/CartPage'
import { getCart } from '../data/marketplace.functions'

export const Route = createFileRoute('/cart')({ loader: () => getCart(), component: CartRoute })
function CartRoute() { return <CartPage initial={Route.useLoaderData()} /> }
