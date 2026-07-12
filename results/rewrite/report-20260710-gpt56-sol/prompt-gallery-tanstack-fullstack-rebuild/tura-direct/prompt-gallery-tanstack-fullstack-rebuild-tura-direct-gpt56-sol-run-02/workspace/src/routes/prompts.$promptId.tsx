import { createFileRoute } from '@tanstack/react-router'
import { PromptDetail } from '../components/PromptDetail'
import { getCartFn, getPromptFn } from '../server/marketplace.functions'

export const Route=createFileRoute('/prompts/$promptId')({
  loader:async({params})=>({prompt:await getPromptFn({data:{promptId:Number(params.promptId)}}),cart:await getCartFn()}),
  component:Page,
})
function Page(){return <PromptDetail {...Route.useLoaderData()}/>}
