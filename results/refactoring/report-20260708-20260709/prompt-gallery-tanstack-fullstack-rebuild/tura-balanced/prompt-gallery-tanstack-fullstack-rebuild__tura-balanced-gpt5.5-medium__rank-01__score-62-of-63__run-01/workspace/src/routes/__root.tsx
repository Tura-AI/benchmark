import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

import { ToastProvider } from '../components/toast'
import '../styles.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'POWERPROMPT - Prompt Marketplace' },
    ],
  }),
  component: RootDocument,
})

function RootDocument() {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        <ToastProvider><Outlet /></ToastProvider>
        <Scripts />
      </body>
    </html>
  )
}
