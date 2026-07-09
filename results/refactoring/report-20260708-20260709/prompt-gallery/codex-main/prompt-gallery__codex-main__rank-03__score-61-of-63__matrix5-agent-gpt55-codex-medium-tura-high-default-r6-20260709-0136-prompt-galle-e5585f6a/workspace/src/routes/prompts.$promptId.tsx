import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { PromptPreview } from '../components/Gallery'
import { api } from '../market-api'
import type { PromptCard } from '../types'

export const Route = createFileRoute('/prompts/$promptId')({
  loader: async ({ params }) => {
    const prompt = await api.prompt(Number(params.promptId))
    if (!prompt) throw notFound()
    return prompt as PromptCard
  },
  component: PromptDetail,
})

function PromptDetail() {
  const prompt = Route.useLoaderData()
  return (
    <div className="detail-page">
      <Link to="/" className="back-link">
        <ArrowLeft /> Back to gallery
      </Link>
      <PromptPreview prompt={prompt} />
    </div>
  )
}
