# React TanStack Start Start Basic React Query Example | TanStack Start Docs

Source: https://tanstack.com/start/latest/docs/framework/react/examples/start-basic-react-query

import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import * as React from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import appCss from '~/styles/app.css?url'
import { seo } from '~/utils/seo'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      ...seo({
        title:
          'TanStack Start | Type-Safe, Client-First, Full-Stack React Framework',
        description: `TanStack Start is a type-safe, client-first, full-stack React framework. `,
      }),
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16.png',
      },
      { rel: 'manifest', href: '/site.webmanifest', color: '#fffff' },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  errorComponent: (props) => {
    return (

    )
  },
  notFoundComponent: () => ,
  component: RootComponent,
})

function RootComponent() {
  return (

  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (

            Home
          {' '}

            Posts
          {' '}

            Users
          {' '}

            Pathless Layout
          {' '}

            Deferred
          {' '}

            This Route Does Not Exist

---

        {children}

  )
}
```

[Blog](https://tanstack.com/blog)

[@Tan_Stack on X.com](https://x.com/tan_stack)

[@TannerLinsley on X.com](https://x.com/tannerlinsley)

[GitHub](https://github.com/tanstack)

[YouTube](https://youtube.com/@tan_stack)

[Nozzle.io - Keyword Rank Tracker](https://nozzle.io/)

[Ethos](https://tanstack.com/ethos)

[Tenets](https://tanstack.com/tenets)

[Privacy Policy](https://tanstack.com/privacy)

[Terms of Service](https://tanstack.com/terms)

© 2026 TanStack LLC

[Partners](https://tanstack.com/partners)[Become a Partner](https://docs.google.com/document/d/1Hg2MzY2TU6U3hFEZ3MLe2oEOM3JS4-eByti3kdJU3I8)

Gold

[![Image 29: Lovable](https://tanstack.com/assets/lovable-black-1mVxR6Bj.svg)![Image 30: Lovable](https://tanstack.com/assets/lovable-white-DLB1BxKZ.svg)](https://lovable.dev/?utm_source=tanstack)[![Image 31: CodeRabbit](https://tanstack.com/assets/coderabbit-light-CIzGLYU_.svg)![Image 32: CodeRabbit](https://tanstack.com/assets/coderabbit-dark-D643Zkrv.svg)](https://coderabbit.link/tanstack?utm_source=tanstack&via=tanstack)[![Image 33: Cloudflare](https://tanstack.com/assets/cloudflare-black-6Ojsn8yh.svg)![Image 34: Cloudflare](https://tanstack.com/assets/cloudflare-white-Co-Tyjbl.svg)](https://www.cloudflare.com/?utm_source=tanstack)[![Image 35: Netlify](blob:http://localhost/7969df8e4856c980e3ec33e810b2fdd3)![Image 36: Netlify](blob:http://localhost/24d73375638b043256608924f69862f0)](https://netlify.com/?utm_source=tanstack)[![Image 37: Railway](https://tanstack.com/assets/railway-black-DeBDfNao.svg)![Image 38: Railway](https://tanstack.com/assets/railway-white-CFKFsfw2.svg)](https://railway.com/?utm_medium=sponsor&utm_source=oss&utm_campaign=tanstack)

Silver

[![Image 39: OpenRouter](https://tanstack.com/assets/openrouter-black-DNn7_580.svg)![Image 40: OpenRouter](https://tanstack.com/assets/openrouter-white-COMTfjvn.svg)](https://openrouter.ai/?utm_source=tanstack)[![Image 41: AG Grid](blob:http://localhost/e1a96eded451fe5afb31b85553d97c14)![Image 42: AG Grid](blob:http://localhost/4383c5eabbf0d845a08f654bc36ec5a0)](https://ag-grid.com/react-data-grid/?utm_source=reacttable&utm_campaign=githubreacttable)[![Image 43: Clerk](https://tanstack.com/assets/clerk-logo-light-BYN-U_0H.svg)![Image 44: Clerk](https://tanstack.com/assets/clerk-logo-dark-CRE22T_2.svg)](https://go.clerk.com/wOwHtuJ)[![Image 45: WorkOS](https://tanstack.com/assets/workos-black-DnPI5Ve5.svg)![Image 46: WorkOS](blob:http://localhost/63ab9198a3814086bee58577222efe05)](https://workos.com/?utm_source=tanstack)[![Image 47: SerpAPI](https://tanstack.com/assets/serpapi-black-DnXRiQQ3.svg)![Image 48: SerpAPI](https://tanstack.com/assets/serpapi-white-CPxTEZSp.svg)](https://serpapi.com/?utm_source=tanstack)

Bronze

[![Image 49: Unkey](blob:http://localhost/58850309d06dec25049a27f46f477723)![Image 50: Unkey](blob:http://localhost/1f4ec7445816c68b361670da8b85b070)](https://www.unkey.com/?utm_source=tanstack)[![Image 51: Prisma](https://tanstack.com/assets/prisma-light-Cloa3Onm.svg)![Image 52: Prisma](https://tanstack.com/assets/prisma-dark-DwgDxLwn.svg)](https://www.prisma.io/?utm_source=tanstack&via=tanstack)[![Image 53: Electric](https://tanstack.com/assets/electric-light-C-5MDda4.svg)![Image 54: Electric](https://tanstack.com/assets/electric-dark-Bfu2Vl2j.svg)](https://electric-sql.com/)[![Image 55: Sentry](blob:http://localhost/2ec396d44617754f9899dbf8f84e8284)![Image 56: Sentry](blob:http://localhost/fa9092f27899d80931754571c5f0d3a2)](https://sentry.io/?utm_source=tanstack)

[Latest Posts](https://tanstack.com/blog)

## Media links

- <https://tanstack.com/cdn-cgi/image/width=30,quality=90,format=auto/images/logos/logo-color-100.png>
