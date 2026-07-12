# React TanStack Start Basic Example | TanStack Start Docs

Source: https://tanstack.com/start/latest/docs/framework/react/examples/basic

This is the notFoundComponent configured on root route

Start Over

          Home
        {' '}

          Posts
        {' '}

          Pathless Layout
        {' '}

          This Route Does Not Exist

  )
}
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexComponent,
})

function IndexComponent() {
  return (
    ### Welcome Home!

  )
}

export const postsLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'posts',
  loader: () => fetchPosts(),
}).lazy(() => import('./posts.lazy').then((d) => d.Route))

const postsIndexRoute = createRoute({
  getParentRoute: () => postsLayoutRoute,
  path: '/',
  component: PostsIndexComponent,
})

function PostsIndexComponent() {
  return Select a post.
}

const postRoute = createRoute({
  getParentRoute: () => postsLayoutRoute,
  path: '$postId',
  errorComponent: PostErrorComponent,
  loader: ({ params }) => fetchPost(params.postId),
  component: PostComponent,
})

function PostErrorComponent({ error }: ErrorComponentProps) {
  if (error instanceof NotFoundError) {
    return {error.message}
  }

  return
}

function PostComponent() {
  const post = postRoute.useLoaderData()

  return (
    #### {post.title}

---

{post.body}
  )
}

const pathlessLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_pathlessLayout',
  component: PathlessLayoutComponent,
})

function PathlessLayoutComponent() {
  return (
    I'm a pathless layout
  )
}

const nestedPathlessLayout2Route = createRoute({
  getParentRoute: () => pathlessLayoutRoute,
  id: '_nestedPathlessLayout',
  component: PathlessLayout2Component,
})

function PathlessLayout2Component() {
  return (
    I'm a nested pathless layout
          Go to Route A

          Go to Route B

  )
}

const pathlessLayoutARoute = createRoute({
  getParentRoute: () => nestedPathlessLayout2Route,
  path: '/route-a',
  component: PathlessLayoutAComponent,
})

function PathlessLayoutAComponent() {
  return I'm route A!
}

const pathlessLayoutBRoute = createRoute({
  getParentRoute: () => nestedPathlessLayout2Route,
  path: '/route-b',
  component: PathlessLayoutBComponent,
})

function PathlessLayoutBComponent() {
  return I'm route B!
}

const routeTree = rootRoute.addChildren([
  postsLayoutRoute.addChildren([postRoute, postsIndexRoute]),
  pathlessLayoutRoute.addChildren([
    nestedPathlessLayout2Route.addChildren([
      pathlessLayoutARoute,
      pathlessLayoutBRoute,
    ]),
  ]),
  indexRoute,
])

// Set up a Router instance
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultStaleTime: 5000,
  scrollRestoration: true,
})

// Register things for typesafety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)

  root.render()
}
```
