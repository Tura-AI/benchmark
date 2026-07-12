import { createFileRoute } from '@tanstack/react-router'
import { promptDetailApi, storefrontApi } from '@/server/api'

export const Route = createFileRoute('/api/prompt/$promptId')({
  server: {
    handlers: {
      GET: ({ params }) => {
        const detail = promptDetailApi(Number(params.promptId))
        return Response.json({ ...detail, categories: storefrontApi().categories })
      },
    },
  },
})
