import { createFileRoute } from '@tanstack/react-router'
import { PromptDetail } from '~/components/PromptDetail'
import { getPromptDetail } from '~/server/marketplace.functions'

export const Route = createFileRoute('/prompt/$promptId')({
  loader: ({ params }) => getPromptDetail({ data: { promptId: Number(params.promptId) } }),
  component: PromptPage,
})

function PromptPage() {
  const prompt = Route.useLoaderData()
  return prompt ? <PromptDetail prompt={prompt} page /> : <main className="not-found"><h1>Prompt not found</h1><a href="/">Return to gallery</a></main>
}
