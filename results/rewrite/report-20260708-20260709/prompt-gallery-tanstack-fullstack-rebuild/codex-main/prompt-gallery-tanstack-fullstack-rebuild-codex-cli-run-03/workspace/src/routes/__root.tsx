import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'
import { api } from '../market-api'
import appCss from '../styles/app.css?url'

export const Route = createRootRoute({
  loader: () => api.shell(),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'POWERPROMPT - Prompt Marketplace' },
      { name: 'description', content: 'A full-stack TanStack Start prompt marketplace.' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;450;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootDocument,
})

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <AppShell />
        <Scripts />
      </body>
    </html>
  )
}
