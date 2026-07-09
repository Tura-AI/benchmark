# Prompt Gallery Full-Stack TanStack rebuild task

Agent: tura-balanced
Source HTML: makeup.html

Convert makeup.html into a production full-stack TanStack Start product in this directory.

Requirements:
- Use a real TanStack Start application structure, including the appropriate app/vite/start configuration and file based routing under src/routes. Do not make a plain Vite-only React app with a decorative TanStack dependency.
- Preserve the original page's visual identity, typography, responsive layout, and interactions from makeup.html.
- Recreate the complete frontend product experience from the source page: the POWERPROMPT brand, sticky sidebar/navigation, top model filter bar, sort controls, search reveal, masonry-style prompt gallery, varied media card aspect ratios, image-based prompt previews, hover overlays, save/favorite behavior, cart/dock actions, toast feedback, lightbox/detail preview, and mobile drawer/dock layout.
- Keep the source domain vocabulary visible where it belongs, including the original model/filter/sort concepts such as GPT-4o, Claude, Midjourney, Flux, Featured, Newest, Popular, Favorites, and Cart.
- Split meaningful UI into React components instead of leaving one giant HTML string.
- Keep styles maintainable in source files that belong to the app.
- Add a real backend layer for the prompt marketplace. Use TanStack Start server functions, API routes, or server-side route loaders/actions for catalog reads, search/filtering, favorites/cart mutations, checkout simulation, and creator/admin analytics.
- Add a local database layer with seed data derived from the source page. SQLite is preferred. Keep schema, seed data, and query helpers in source-controlled files. If you choose a file database, it must be created under the project workspace only.
- Implement database-side calculations, not just frontend array math. Required computed data includes prompt ranking, featured/free filters, cart totals, creator revenue, conversion rate, average price, category totals, and daily sales or trend summaries.
- Surface those backend/database values in the UI through routes, loaders, API calls, or server functions. Include at least a storefront route, prompt detail route, cart or checkout route, and creator/admin analytics route.
- Provide npm scripts for dev, build, and start or preview.
- Provide more than one test command. Include unit tests for database/query calculations, API/server-function tests for backend behavior, and a browser/component/e2e smoke test for the main user flows.
- Install Playwright by default in package.json, preferably both @playwright/test and playwright or whichever your browser test imports.
- Install any required dependencies in package.json.
- Verify with npm install, npm run build, the database/API/unit test scripts, and at least one browser smoke check.
- Do not ask the user questions or stop early while the task can still be completed locally. Keep setting up the environment, fixing failures, running the required tests, and iterating until the app is complete and the tests pass. Only ask a question if the current environment truly cannot run the required validation after reasonable setup effort.
- Do not read or compare against the sibling makeup-codex or makeup-tura project.
