import { createFileRoute } from '@tanstack/react-router';
import { AdminView } from '../components';
import { getAnalyticsFn } from '../server/functions';

export const Route = createFileRoute('/admin')({
  loader: () => getAnalyticsFn(),
  component: AdminRoute
});

function AdminRoute() {
  const analytics = Route.useLoaderData();
  return <AdminView analytics={analytics} />;
}
