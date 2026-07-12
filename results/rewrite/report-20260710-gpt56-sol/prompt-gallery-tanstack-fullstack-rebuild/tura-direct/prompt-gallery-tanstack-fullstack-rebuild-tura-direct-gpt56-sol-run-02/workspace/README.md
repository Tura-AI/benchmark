# POWERPROMPT

A local full-stack prompt marketplace built with TanStack Start, React, TypeScript, and SQLite.

## Run

```bash
npm install
npm run dev
```

Production: `npm run build` then `npm run start`.

## Checks

- `npm run typecheck`
- `npm run test:db`
- `npm run test:api`
- `npm run test:e2e`

The SQLite database is created and seeded at `data/powerprompt.db` on first request. Set `POWERPROMPT_DB` to use another workspace-local database path.
