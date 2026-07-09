import { createFileRoute, notFound } from '@tanstack/react-router'
import { PromptDetail } from '@/components/detail'
import { Shell } from '@/components/layout'
import { getPromptDetail, getStorefront } from '@/server/marketplace'
import { imageUrl } from '@/db/queries'

export const Route = createFileRoute('/prompts/$promptId')({
  loader: async ({ params }) => {
    const promptId = Number(params.promptId)
    if (!Number.isInteger(promptId)) throw notFound()
    const [detail, shell] = await Promise.all([getPromptDetail({ data: { promptId } }), getStorefront({ data: {} })])
    return { ...detail, shell }
  },
  component: PromptRoute,
})

function PromptRoute() {
  const data = Route.useLoaderData()
  const prompt = { ...data.prompt, imageUrl: imageUrl(data.prompt.id, data.prompt.aspectRatio) }
  return <Shell categories={data.shell.categories} cartCount={data.cart.count}><PromptDetail prompt={prompt} /></Shell>
}
