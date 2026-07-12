# POWERPROMPT

A full-stack prompt marketplace built with TanStack Start, React, TypeScript, and SQLite.

## Run

```bash
npm install
npm run dev
```

The app runs at `http://127.0.0.1:4173`. The SQLite database is created and seeded at `data/powerprompt.sqlite` on first server access.

## Quality checks

```bash
npm run typecheck
npm run build
npm run test:db
npm run test:api
npm run test:e2e
```

The storefront uses TanStack Start loaders and server functions for catalog reads, persisted favorites/cart mutations, checkout, and creator analytics. `/api/prompts` is the public catalog API boundary.
