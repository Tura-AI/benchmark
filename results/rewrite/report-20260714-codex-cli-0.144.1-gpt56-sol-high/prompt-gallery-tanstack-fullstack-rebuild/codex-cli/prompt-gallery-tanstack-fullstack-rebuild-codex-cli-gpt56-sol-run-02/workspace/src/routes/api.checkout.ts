import { createFileRoute } from '@tanstack/react-router'
import { serverCheckoutApi } from '../data/server-boundary'
export const Route = createFileRoute('/api/checkout')({ server: { handlers: { POST: () => serverCheckoutApi() } } })
