import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { Shell } from '../components/Shell'
import '../styles.css'

export const rootRoute = createRootRoute({
  head: () => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'POWERPROMPT — Prompt Marketplace' }] }),
  component: () => <><HeadContent /><Shell /><Scripts /></>,
})

export const Route = rootRoute
