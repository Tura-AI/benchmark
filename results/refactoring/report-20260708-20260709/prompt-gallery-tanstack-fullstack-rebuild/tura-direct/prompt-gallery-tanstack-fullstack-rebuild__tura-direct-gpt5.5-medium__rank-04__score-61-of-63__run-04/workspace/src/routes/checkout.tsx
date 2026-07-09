import { createFileRoute } from '@tanstack/react-router'
import { CartPage } from '~/components/CartPage'
import { fetchCart } from '~/data/server'

export const Route = createFileRoute('/checkout')({ loader: () => fetchCart(), component: () => <CartPage initialCart={Route.useLoaderData()} /> })
