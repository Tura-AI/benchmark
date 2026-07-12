# POWERPROMPT architecture

POWERPROMPT is a TanStack Start application with file-based routes. Route loaders call typed server functions; browser interactions call the same functions through Start's RPC boundary. SQLite is the persistence boundary and owns catalog ranking, filter counts, cart arithmetic, checkout, and analytics aggregates.

## Modules

- `src/routes`: pages and public JSON route handlers.
- `src/components`: reusable marketplace navigation, gallery, commerce, and analytics UI.
- `src/server/schema.sql`: local relational schema and indexes.
- `src/server/seed.ts`: deterministic 22-prompt catalog, creators, users, orders, and sessions.
- `src/server/queries.server.ts`: parameterized query and transaction layer.
- `src/server/marketplace.functions.ts`: validated TanStack Start server-function contracts.
- `src/contracts.ts`: client-safe Zod inputs and result types.

The demo uses a fixed local user (`id=1`) instead of pretending to provide authentication. A production deployment would replace that boundary with an authenticated session while retaining the same user-scoped query signatures.
