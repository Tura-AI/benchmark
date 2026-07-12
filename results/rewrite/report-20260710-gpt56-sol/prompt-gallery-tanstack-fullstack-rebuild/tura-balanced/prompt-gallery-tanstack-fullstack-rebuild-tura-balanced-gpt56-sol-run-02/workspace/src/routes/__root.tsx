import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import appCss from '../styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'description', content: 'Curated, field-tested prompts for creative work.' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
    title: 'POWERPROMPT — Prompt Gallery',
  }),
  shellComponent: ({ children }) => <html lang="en"><head><HeadContent /></head><body>{children}<Scripts /></body></html>,
  component: () => <Outlet />,
  notFoundComponent: () => <main className="not-found"><span className="eyebrow">404</span><h1>That prompt slipped away.</h1><a href="/">Return to the gallery</a></main>,
})
