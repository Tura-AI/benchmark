import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import '../styles.css';

export const Route = createRootRoute({
  head: () => ({ meta: [{ title: 'POWERPROMPT — Prompt Marketplace' }] }),
  component: Root
});

function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>POWERPROMPT — Prompt Marketplace</title>
      </head>
      <body>
        <a className="skip" href="#content">Skip to content</a>
        <Outlet />
        <nav className="dock" aria-label="Mobile navigation">
          <Link to="/" activeOptions={{ exact: true }}>Home</Link>
          <Link to="/" search={{ favorites: true, sort: 'Featured' }}>Favorites</Link>
          <Link to="/cart">Cart</Link>
          <Link to="/admin">Analytics</Link>
        </nav>
      </body>
    </html>
  );
}
