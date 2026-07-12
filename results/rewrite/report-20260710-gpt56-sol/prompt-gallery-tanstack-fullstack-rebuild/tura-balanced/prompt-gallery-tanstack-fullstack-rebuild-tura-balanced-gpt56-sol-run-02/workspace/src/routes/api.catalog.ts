import { createFileRoute } from '@tanstack/react-router'
import { catalogResponse } from '../server/api'
export const Route = createFileRoute('/api/catalog')({ server: { handlers: { GET: ({ request }) => catalogResponse(request) } } })
