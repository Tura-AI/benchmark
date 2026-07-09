import { createFileRoute, notFound } from '@tanstack/react-router';
import { DetailView } from '../components';
import { getCatalogFn, getPromptFn } from '../server/functions';

export const Route = createFileRoute('/prompts/$promptId')({
  loader: async ({ params }) => {
    const prompt = await getPromptFn({ data: { promptId: params.promptId } });
    if (!prompt) throw notFound();
    const related = await getCatalogFn({ data: { category: 'all', sort: 'Popular' } });
    return { prompt, related: related.prompts.filter((item) => item.id !== prompt.id) };
  },
  component: PromptRoute
});

function PromptRoute() {
  const { prompt, related } = Route.useLoaderData();
  return <DetailView prompt={prompt} related={related} />;
}
