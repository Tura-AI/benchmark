import { createFileRoute } from '@tanstack/react-router'
import { analyticsResponse } from '~/server/api.server'

export const Route = createFileRoute('/api/analytics')({ server: { handlers: { GET: () => Response.json(analyticsResponse()) } } })
