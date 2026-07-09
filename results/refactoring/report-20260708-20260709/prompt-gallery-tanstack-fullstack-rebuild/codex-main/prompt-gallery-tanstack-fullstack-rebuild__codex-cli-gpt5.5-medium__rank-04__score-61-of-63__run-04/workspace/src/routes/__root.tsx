import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { ToastProvider } from '@/components/useToast'
import appCss from '@/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'POWERPROMPT - Prompt Gallery' },
      { name: 'description', content: 'A full-stack TanStack Start prompt marketplace.' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: Root,
})

function Root() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
        <Scripts />
      </body>
    </html>
  )
}
