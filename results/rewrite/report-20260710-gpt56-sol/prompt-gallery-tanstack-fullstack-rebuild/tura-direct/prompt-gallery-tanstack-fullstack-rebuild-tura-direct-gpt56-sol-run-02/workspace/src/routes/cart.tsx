import { createFileRoute } from '@tanstack/react-router'
import { CartPage } from '../components/CartPage'
import { getCartFn } from '../server/marketplace.functions'
export const Route=createFileRoute('/cart')({loader:()=>getCartFn(),component:Page})
function Page(){return <CartPage cart={Route.useLoaderData()}/>}
