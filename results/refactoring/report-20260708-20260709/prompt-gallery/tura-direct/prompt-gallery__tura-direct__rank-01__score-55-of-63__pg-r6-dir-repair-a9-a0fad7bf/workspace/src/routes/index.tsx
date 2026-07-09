import { createFileRoute } from '@tanstack/react-router';
import { Storefront } from '../components';
import { getCatalogFn } from '../server/functions';
import type { SortMode } from '../types';

type Search = { model?: string; category?: string; sort?: SortMode; q?: string; favorites?: boolean };

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    model: typeof search.model === 'string' ? search.model : 'all',
    category: typeof search.category === 'string' ? search.category : 'all',
    sort: search.sort === 'Newest' || search.sort === 'Popular' ? search.sort : 'Featured',
    q: typeof search.q === 'string' ? search.q : '',
    favorites: search.favorites === true || search.favorites === 'true'
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getCatalogFn({ data: deps }),
  component: StoreRoute
});

function StoreRoute() {
  const catalog = Route.useLoaderData();
  const search = Route.useSearch();
  return <Storefront catalog={catalog} search={search} />;
}
