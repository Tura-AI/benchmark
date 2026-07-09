# Server Functions - TanStack Router

Source: https://tanstack-router-54.mintlify.app/start/api/server-functions

required

Array of middleware functions or middleware instances to apply to this server function.

```
const authMiddleware = createMiddleware().server(async ({ next }) => {
  // Check authentication
  return next({ context: { userId: '123' } })
})

const protectedFn = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    console.log(context.userId) // '123'
    return { success: true }
  })
```

#### `.inputValidator()`

Validates and transforms input data using a validator (Zod, Valibot, ArkType, or custom function).

validator

Validator

required

A validation schema or function that validates the input data. Supports Standard Schema validators like Zod, Valibot, and ArkType.

```
import { z } from 'zod'

const createUserFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    name: z.string(),
    email: z.string().email(),
  }))
  .handler(async ({ data }) => {
    // data is typed as { name: string, email: string }
    return { id: '1', ...data }
  })

// Call with validated data
await createUserFn({ data: { name: 'Jane', email: 'jane@example.com' } })
```

#### `.handler()`

Defines the server-side handler function that executes when the server function is called.

fn

ServerFn

required

The server-side function to execute. Receives a context object with `data`, `context`, `method`, and `serverFnMeta`.

```
const myFn = createServerFn().handler(async (ctx) => {
  // ctx.data - Input data (after validation)
  // ctx.context - Context from middleware
  // ctx.method - HTTP method ('GET' | 'POST')
  // ctx.serverFnMeta - Metadata (id, name, filename)

  return { result: 'success' }
})
```

### Handler Context

The handler function receives a context object with the following properties:

data

any

The validated input data. Type is inferred from the inputValidator if provided.

context

object

Context object accumulated from middleware. Contains values added by middleware and global context.

method

'GET' | 'POST'

The HTTP method used for this server function.

serverFnMeta

ServerFnMeta

Metadata about the server function including:

*   `id`: Unique function identifier
*   `name`: Function name
*   `filename`: Source file path

### Calling Server Functions

Server functions can be called with optional configuration:

```
// No input data
await myFn()

// With input data
await myFn({ data: { name: 'John' } })

// With headers
await myFn({
  data: { name: 'John' },
  headers: { 'X-Custom': 'value' }
})

// With custom fetch
await myFn({
  data: { name: 'John' },
  fetch: customFetch
})

// With abort signal
const controller = new AbortController()
await myFn({
  data: { name: 'John' },
  signal: controller.signal
})
```

### Call Options

data

any

The input data to send to the server. Required if inputValidator requires input.

headers

HeadersInit

Custom headers to include in the request.

signal

AbortSignal

AbortSignal for cancelling the request.

fetch

typeof fetch

Custom fetch implementation to use instead of global fetch.

### Method Selection

#### GET Requests

*   Data is serialized in URL query parameters
*   Suitable for idempotent operations
*   Limited payload size
*   Cacheable by browsers and CDNs

```
const fetchUserFn = createServerFn({ method: 'GET' })
  .inputValidator((userId: string) => userId)
  .handler(async ({ data }) => {
    return await db.user.findById(data)
  })
```

#### POST Requests

*   Data sent in request body
*   Supports larger payloads
*   Supports FormData for file uploads
*   Not cached by default

```
const uploadFileFn = createServerFn({ method: 'POST' })
  .handler(async ({ data }) => {
    if (data instanceof FormData) {
      const file = data.get('file')
      // Handle file upload
    }
    return { success: true }
  })
```

### Advanced Examples

#### Chaining Multiple Middleware

```
const complexFn = createServerFn()
  .middleware([authMiddleware, loggingMiddleware])
  .inputValidator(mySchema)
  .handler(async ({ data, context }) => {
    // Access context from all middleware
    return { result: data }
  })
```

#### Returning Responses

```
const customResponseFn = createServerFn().handler(async () => {
  // Return a custom Response object
  return new Response('Custom content', {
    headers: { 'Content-Type': 'text/plain' }
  })
})
```

#### Error Handling

```
const errorFn = createServerFn().handler(async () => {
  throw new Error('Something went wrong')
  // Error is automatically serialized and thrown on client
})

try {
  await errorFn()
} catch (error) {
  console.error(error.message) // 'Something went wrong'
}
```

### Type Safety

Server functions are fully type-safe:

*   Input types are inferred from validators
*   Context types are inferred from middleware
*   Return types are preserved across the network
*   Serialization is automatically validated

```
const typedFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ count: z.number() }))
  .handler(async ({ data }) => {
    // data is typed as { count: number }
    return { doubled: data.count * 2 }
  })

// result is typed as { doubled: number }
const result = await typedFn({ data: { count: 5 } })
```
