# Build a Project from Scratch

Source: https://tanstack.com/start/latest/docs/framework/react/build-from-scratch

{children}

  )
}
```

## Writing Your First Route

Now that we have the basic templating setup, we can write our first route. This is done by creating a new file in the `src/routes` directory.

```tsx
// src/routes/index.tsx
import * as fs from 'node:fs'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

const filePath = 'count.txt'

async function readCount() {
  return parseInt(
    await fs.promises.readFile(filePath, 'utf-8').catch(() => '0'),
  )
}

const getCount = createServerFn({
  method: 'GET',
}).handler(() => {
  return readCount()
})

const updateCount = createServerFn({ method: 'POST' })
  .validator((d: number) => d)
  .handler(async ({ data }) => {
    const count = await readCount()
    await fs.promises.writeFile(filePath, `${count + data}`)
  })

export const Route = createFileRoute('/')({
  component: Home,
  loader: async () => await getCount(),
})

function Home() {
  const router = useRouter()
  const state = Route.useLoaderData()

  return (
     {
        updateCount({ data: 1 }).then(() => {
          router.invalidate()
        })
      }}
    >
      Add 1 to {state}?

  )
}
```

That's it! 🤯 You've now set up a TanStack Start project and written your first route. 🎉

You can now run `npm run dev` to start your server and navigate to `http://localhost:3000` to see your route in action.

You want to deploy your application? Check out the [hosting guide](./guide/hosting.md).
