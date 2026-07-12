import { createFileRoute } from '@tanstack/react-router'
import { addCartApi, cartApi, checkoutApi, removeCartApi, storefrontApi } from '@/server/api'

export const Route = createFileRoute('/api/cart')({
  server: {
    handlers: {
      GET: () => Response.json({ cart: cartApi(), categories: storefrontApi().categories }),
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}))
        if (body.action === 'add') return Response.json(addCartApi(Number(body.promptId)))
        if (body.action === 'remove') return Response.json(removeCartApi(Number(body.promptId)))
        if (body.action === 'checkout') return Response.json(checkoutApi())
        return new Response('Unknown cart action', { status: 400 })
      },
    },
  },
})
