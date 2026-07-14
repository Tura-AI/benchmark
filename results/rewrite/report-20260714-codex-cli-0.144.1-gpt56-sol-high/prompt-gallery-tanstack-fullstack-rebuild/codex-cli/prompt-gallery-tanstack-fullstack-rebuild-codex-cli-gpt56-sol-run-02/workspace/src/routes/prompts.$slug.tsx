import { createFileRoute, notFound } from '@tanstack/react-router'
import { PromptDetailPage } from '../components/PromptDetailPage'
import { getPromptDetail } from '../data/marketplace.functions'

export const Route = createFileRoute('/prompts/$slug')({
  loader: async ({ params }) => {
    const prompt = await getPromptDetail({ data: { slug: params.slug } })
    if (!prompt) throw notFound()
    return prompt
  },
  component: DetailRoute,
  notFoundComponent: () => <main className="simple-message"><h1>Prompt not found</h1><a href="/">Return to the gallery</a></main>,
})

function DetailRoute() { return <PromptDetailPage initial={Route.useLoaderData()} /> }
