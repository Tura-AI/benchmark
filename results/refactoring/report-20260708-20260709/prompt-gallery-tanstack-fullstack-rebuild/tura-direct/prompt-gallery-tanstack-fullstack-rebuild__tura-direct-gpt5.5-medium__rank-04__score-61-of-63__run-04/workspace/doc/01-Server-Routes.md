# Server Routes

Source: https://tanstack.com/start/latest/docs/framework/react/guide/server-routes

{
          fetch('/hello', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: 'Tanner' }),
          })
            .then((res) => res.json())
            .then((data) => setReply(data.message))
        }}
      >
        Say Hello
      ` or even use any of the helpers from `@tanstack/react-start` to manipulate the response.

## Dynamic Path Params

Server routes support dynamic path parameters in the same way as TanStack Router. For example, a file named `routes/users/$id.ts` will create an API route at `/users/$id` that accepts a dynamic `id` parameter.

```ts
// routes/users/$id.ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/users/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { id } = params
        return new Response(`User ID: ${id}`)
      },
    },
  },
})

// Visit /users/123 to see the response
// User ID: 123
```

You can also have multiple dynamic path parameters in a single route. For example, a file named `routes/users/$id/posts/$postId.ts` will create an API route at `/users/$id/posts/$postId` that accepts two dynamic parameters.

```ts
// routes/users/$id/posts/$postId.ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/users/$id/posts/$postId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { id, postId } = params
        return new Response(`User ID: ${id}, Post ID: ${postId}`)
      },
    },
  },
})

// Visit /users/123/posts/456 to see the response
// User ID: 123, Post ID: 456
```

## Wildcard/Splat Param

Server routes also support wildcard parameters at the end of the path, which are denoted by a `$` followed by nothing. For example, a file named `routes/file/$.ts` will create an API route at `/file/$` that accepts a wildcard parameter.

```ts
// routes/file/$.ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/file/$')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { _splat } = params
        return new Response(`File: ${_splat}`)
      },
    },
  },
})

// Visit /file/hello.txt to see the response
// File: hello.txt
```

## Handling requests with a body

To handle POST requests, you can add a `POST` handler to the route object. The handler will receive the request object as the first argument, and you can access the request body using the `request.json()` method.

```ts
// routes/hello.ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/hello')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json()
        return new Response(`Hello, ${body.name}!`)
      },
    },
  },
})

// Send a POST request to /hello with a JSON body like { "name": "Tanner" }
// Hello, Tanner!
```

This also applies to other HTTP methods like `PUT`, `PATCH`, and `DELETE`. You can add handlers for these methods in the route object and access the request body using the appropriate method.

It's important to remember that the `request.json()` method returns a `Promise` that resolves to the parsed JSON body of the request. You need to `await` the result to access the body.

This is a common pattern for handling POST requests in Server routes/ You can also use other methods like `request.text()` or `request.formData()` to access the body of the request.

## Responding with JSON

When returning JSON using a Response object, this is a common pattern:

```ts
// routes/hello.ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/hello')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return new Response(JSON.stringify({ message: 'Hello, World!' }), {
          headers: {
            'Content-Type': 'application/json',
          },
        })
      },
    },
  },
})

// Visit /hello to see the response
// {"message":"Hello, World!"}
```

## Using the `Response.json` helper function

Or you can use the [`Response.json`](https://developer.mozilla.org/en-US/docs/Web/API/Response/json_static) helper function to automatically set the `Content-Type` header to `application/json` and serialize the JSON object for you.

```ts
// routes/hello.ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/hello')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return Response.json({ message: 'Hello, World!' })
      },
    },
  },
})

// Visit /hello to see the response
// {"message":"Hello, World!"}
```

## Responding with a status code

You can set the status code of the response by passing it as a property of the second argument to the `Response` constructor

```ts
// routes/hello.ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/hello')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await findUser(params.id)
        if (!user) {
          return new Response('User not found', {
            status: 404,
          })
        }
        return Response.json(user)
      },
    },
  },
})
```

In this example, we're returning a `404` status code if the user is not found. You can set any valid HTTP status code using this method.

## Setting headers in the response

Sometimes you may need to set headers in the response. You can do this by passing an object as the second argument to the `Response` constructor.

```ts
// routes/hello.ts
import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/hello')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return new Response('Hello, World!', {
          headers: {
            'Content-Type': 'text/plain',
          },
        })
      },
    },
  },
})
// Visit /hello to see the response
// Hello, World!
```
