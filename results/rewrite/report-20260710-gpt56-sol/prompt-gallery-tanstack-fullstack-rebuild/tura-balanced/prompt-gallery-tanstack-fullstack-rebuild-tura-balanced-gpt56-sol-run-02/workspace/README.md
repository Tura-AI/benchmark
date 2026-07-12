# POWERPROMPT Marketplace

A full-stack TanStack Start prompt marketplace rebuilt from `makeup.html`.

## Run

```sh
npm install
npm run dev
```

Production build and server:

```sh
npm run build
npm run start
```

## Verification

```sh
npm run typecheck
npm run test:db
npm run test:api
npx playwright install chromium
npm run test:e2e
```

The local SQLite database is created at `data/powerprompt.db` on first server access. Schema, seed data, SQL calculations, and mutations live in `src/server`. The demo user persists favorites, cart items, and simulated orders there.

Routes:

- `/` storefront with search, filtering, favorites, preview, and masonry gallery
- `/prompts/:promptId` prompt detail
- `/cart` cart and checkout simulation
- `/analytics` creator/admin analytics
- `/api/catalog` public catalog API
