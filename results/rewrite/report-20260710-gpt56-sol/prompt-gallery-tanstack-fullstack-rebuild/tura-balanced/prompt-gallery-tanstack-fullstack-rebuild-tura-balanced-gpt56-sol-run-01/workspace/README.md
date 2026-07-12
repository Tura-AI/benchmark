# POWERPROMPT

A full-stack prompt marketplace rebuilt from `makeup.html` with TanStack Start, React, SQLite, and Nitro.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Production build

```bash
npm run build
npm run start
```

The Nitro Node server uses `PORT` and `HOST` when set and defaults to port 3000.

## Verification

```bash
npm run typecheck
npm run lint
npm run test:db
npm run test:api
npm run test:e2e
```

The application seeds `data/powerprompt.sqlite` on first access. It uses a documented fixed local demo user rather than presenting mock authentication as a complete auth system. See `ARCHITECTURE.md` for module boundaries.
