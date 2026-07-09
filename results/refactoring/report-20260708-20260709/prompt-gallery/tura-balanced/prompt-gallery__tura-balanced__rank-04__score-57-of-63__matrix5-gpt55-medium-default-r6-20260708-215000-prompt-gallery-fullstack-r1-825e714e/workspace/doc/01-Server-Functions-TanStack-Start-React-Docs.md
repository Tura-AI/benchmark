# Server Functions | TanStack Start React Docs

Source: https://tanstack.com/start/latest/docs/framework/react/guide/server-functions

Title: Server Functions | TanStack Start React Docs

URL Source: https://tanstack.com/start/latest/docs/framework/react/guide/server-functions

Markdown Content:
Server functions let you define server-only logic that can be called from anywhere in your application - loaders, components, hooks, or other server functions. They run on the server but can be invoked from client code seamlessly.

Server functions provide server capabilities (database access, environment variables, file system) while maintaining type safety across the network boundary.

Note

Server functions are meant to be called by your TanStack Start application. They are easy to use from your app code, and Start handles serialization across the client/server boundary. If you need an endpoint that can be called from outside your Start app, use [server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes) instead.

Server functions are same-origin RPC endpoints for your application. Browser requests to server functions should come from the same origin, verified with Fetch Metadata (Sec-Fetch-Site), Origin, or Referer headers. Use server routes for public APIs or endpoints that intentionally support cross-origin requests.

TanStack Start provides createCsrfMiddleware() to protect server functions from cross-site requests. If your app does not define src/start.ts, Start installs this middleware automatically for server functions. If you define src/start.ts, add the middleware explicitly:

By default, Origin and Referer checks compare against the incoming request URL origin. If your deployment needs to allow a different public origin, configure it on the CSRF middleware with createCsrfMiddleware({ origin: 'https://app.example.com' }).

Tip

Requests without any of these headers (Sec-Fetch-Site, Origin, or Referer) are rejected by default. If your deployment strips these headers and you have another layer that guarantees same-origin server function requests, you can opt in with createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn', allowRequestsWithoutOriginCheck: true }).

Server functions are created with createServerFn() and can specify HTTP method:

Call server functions from:

*   **Route loaders** - Perfect for data fetching

*   **Components** - Use with useServerFn() hook

*   **Other server functions** - Compose server logic

*   **Event handlers** - Handle form submissions, clicks, etc.

For larger applications, consider organizing server-side code into separate files. Here's one approach:

*   **.functions.ts** - Export createServerFn wrappers, safe to import anywhere

*   **.server.ts** - Server-only code, only imported inside server function handlers

*   **.ts** (no suffix) - Client-safe code (types, schemas, constants)

### Example

### Static Imports Are Safe

Server functions can be statically imported in any file, including client components:

The build process replaces server function implementations with RPC stubs in client bundles. The actual server code never reaches the browser.

Warning

Avoid dynamic imports for server functions:

Server functions accept a single data parameter. Since they cross the network boundary, validation ensures type safety and runtime correctness.

### Basic Parameters

### Validation with Zod

For robust validation, use schema libraries like Zod:

### Form Data

Handle form submissions with FormData:

### Serialization Type Checking

Server function inputs and outputs cross the network boundary, so TypeScript checks that they are serializable:

*   Validator input types must be serializable. FormData is also allowed for POST server functions.

*   Handler return types must be serializable. Response objects are allowed.

This default behavior is called strict mode. If you intentionally need to opt out of these type-level serialization checks, pass the strict option to createServerFn:

Warning

strict: false only relaxes TypeScript's serialization checks. Values still need to be handled correctly by the runtime serialization layer when they are sent between the client and server. Prefer the default strict: true unless you know why the default serializability rules are too restrictive for a specific server function.

Server functions can throw errors, redirects, and not-found responses that are handled automatically when called from route lifecycles or components using useServerFn().

### Basic Errors

### Redirects

Use redirects for authentication, navigation, etc:

### Not Found

Throw not-found errors for missing resources:

For more advanced server function patterns and features, see these dedicated guides:

### Server Context & Request Handling

Access request headers, cookies, and customize responses:

> **Cache-Control safety:**public tells every CDN/proxy between you and the user that the response can be served to anyone. If the handler reads a session, cookie, or auth header — or branches on identity at all — using public will cache one user's response and replay it to the next user (cross-tenant data leak). For authenticated responses, use private:

Available utilities:

*   getRequest() - Access the full Request object

*   getRequestHeader(name) - Read a specific request header

*   setResponseHeader(name, value) - Set a single response header

*   setResponseHeaders(headers) - Set multiple response headers via Headers object

*   setResponseStatus(code) - Set the HTTP status code

### Streaming

Stream typed data from server functions to the client. See the [Streaming Data from Server Functions guide](https://tanstack.com/start/latest/docs/framework/react/guide/streaming-data-from-server-functions).

### Raw Responses

Return Response objects binary data, or custom content types.

### Progressive Enhancement

Use server functions without JavaScript by leveraging the .url property with HTML forms.

### Middleware

Compose server functions with middleware for authentication, logging, and shared logic. See the [Middleware guide](https://tanstack.com/start/latest/docs/framework/react/guide/middleware).

> **Protect data in the endpoint that serves it.** Server functions are API endpoints reachable independently of whichever route renders the calling UI. Apply authMiddleware or an equivalent in-handler check to every server function that reads or writes private data. beforeLoad is useful route UX, but it is not the data boundary. See [Authentication Server Primitives](https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives).

### Static Server Functions

Cache server function results at build time for static generation. See [Static Server Functions](https://tanstack.com/start/latest/docs/framework/react/guide/static-server-functions).

### Server Components

Server functions can return Server Components - server-rendered React components that the client can compose. See [Server Components](https://tanstack.com/start/latest/docs/framework/react/guide/server-components).

### Request Cancellation

Handle request cancellation with AbortSignal for long-running operations.

### Function ID generation for production build

Server functions are addressed by a generated, stable function ID under the hood. These IDs are embedded into the client/SSR builds and used by the server to locate and import the correct module at runtime.

By default, IDs are SHA256 hashes of the same seed to keep bundles compact and avoid leaking file paths. If two server functions end up with the same ID (including when using a custom generator), the system de-duplicates by appending an incrementing suffix like _1, _2, etc.

Customization:

You can customize function ID generation for the production build by providing a generateFunctionId function when configuring the TanStack Start build tool plugin.

Prefer deterministic inputs (filename + functionName) so IDs remain stable between builds.

Please note that this customization is **experimental** and subject to change.

Example:

* * *

> **Note**: Server functions use a compilation process that extracts server code from client bundles while maintaining seamless calling patterns. On the client, calls become fetch requests to the server.
