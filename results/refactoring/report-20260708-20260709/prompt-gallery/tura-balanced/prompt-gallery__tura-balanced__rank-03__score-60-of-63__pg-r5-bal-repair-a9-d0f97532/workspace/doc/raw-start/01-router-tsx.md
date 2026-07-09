# router.tsx

Source: https://raw.githubusercontent.com/TanStack/router/main/examples/react/start-basic/src/router.tsx

Title: 

URL Source: https://raw.githubusercontent.com/TanStack/router/main/examples/react/start-basic/src/router.tsx

Markdown Content:
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { DefaultCatchBoundary } from './components/DefaultCatchBoundary'
import { NotFound } from './components/NotFound'

export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => , scrollRestoration: true, }) return router }
