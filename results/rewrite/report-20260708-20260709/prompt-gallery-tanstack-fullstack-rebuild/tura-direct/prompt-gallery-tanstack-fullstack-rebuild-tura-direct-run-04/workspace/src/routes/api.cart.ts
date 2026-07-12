import { createFileRoute } from '@tanstack/react-router'
import { addToCart, getCartSummary } from '~/data/db'

export const Route = createFileRoute('/api/cart')({ server: { handlers: { GET: () => Response.json(getCartSummary(1)), POST: async ({ request }) => { const body = await request.json().catch(() => ({})); return Response.json(addToCart(Number(body.promptId), 1)) } } } })
