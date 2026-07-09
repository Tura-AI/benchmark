import { createFileRoute } from '@tanstack/react-router';
import { CartView } from '../components';
import { getCartFn } from '../server/functions';

export const Route = createFileRoute('/cart')({
  loader: () => getCartFn(),
  component: CartRoute
});

function CartRoute() {
  const cart = Route.useLoaderData();
  return <CartView cart={cart} />;
}
