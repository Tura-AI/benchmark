import { createFileRoute } from '@tanstack/react-router'
import { serverAnalytics } from '../data/server-boundary'
export const Route = createFileRoute('/api/analytics')({ server: { handlers: { GET: async () => Response.json(await serverAnalytics()) } } })
