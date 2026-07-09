import { createFileRoute } from '@tanstack/react-router'
import { getAnalytics } from '~/data/db'

export const Route = createFileRoute('/api/analytics')({ server: { handlers: { GET: () => Response.json(getAnalytics()) } } })
