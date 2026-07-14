# POWERPROMPT Marketplace

A full-stack TanStack Start rebuild of the supplied POWERPROMPT gallery. It includes the responsive storefront, SQL-backed filters and ranking, persistent favorites/cart state, prompt detail pages, simulated checkout, and creator analytics.

## Run

```bash
npm install
npm run dev
```

Production build and preview:

```bash
npm run build
npm run start
```

The SQLite database is created and seeded automatically at `data/powerprompt.db`. Delete that file to restore the original seed state.

## Verify

```bash
npm run test:db
npm run test:api
npx playwright install chromium
npm run test:e2e
```

The database suite covers ranking, catalog filters, cart math, checkout, revenue, conversion, average order value, category aggregates, and daily sales. API tests exercise the HTTP boundary, and Playwright checks desktop plus mobile marketplace flows.
