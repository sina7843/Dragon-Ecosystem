# Dragon Ecosystem

Bilingual (Persian/English) esports news and tournament platform. Phase 1 covers content, games, teams, tournaments, and competition operations; later phases add streaming, education, community, and commerce.

Product baseline: `Requirements.md`. Approved implementation choices: `IMPLEMENTATION_DECISIONS.md`. Architecture: `ARCHITECTURE.md`. Delivery order: `prompts/prompt-manifest.json` and `PROJECT_STATUS.md`.

## Layout

| Path | Contents |
|---|---|
| `apps/web` | Vue 3 + Vite + TypeScript frontend |
| `apps/api` | Node.js + Fastify + TypeScript API |
| `scripts` | Repository verification scripts |
| `prompts` | Staged delivery prompts (read-only source material) |
| `tools` | Windows setup and packaging helpers (read-only source material) |

## Local development

Requires Node.js 22.12 or newer and Docker Desktop.

```bash
npm install                 # install the workspace from the committed lockfile
npm run dev --workspace @dragon/api   # API on http://127.0.0.1:3000
npm run dev --workspace @dragon/web   # web on http://127.0.0.1:5173
```

The web dev server proxies `/api` to the API, so the browser always uses a same-origin path.

Environment variables are documented in `ENVIRONMENT_VARIABLES.md`. Safe defaults cover local development, so no `.env` file is required to start. When you do need one, copy `.env.example` manually or run `06-CREATE-LOCAL-ENV.cmd`.

## Checks

```bash
npm run typecheck           # tsc + vue-tsc across both apps
npm run lint                # ESLint, including module dependency rules
npm test                    # unit tests (node:test), no database needed
npm run test:integration    # starts the test database, then the integration suite
npm run build               # production builds
npm run e2e                 # starts the test database, builds, then Playwright in fa RTL and en LTR
npm run verify:persistence  # proves MongoDB data survives a Compose stop/start
npm run migrate             # explicit migration + seed release step
```

`npm run e2e` needs the browser binary once: `npx playwright install chromium` inside `apps/web`.

Integration and browser tests need Docker: they use a disposable in-memory MongoDB from `docker-compose.test.yml` on host port 27018, separate from the default stack. `npm run db:test:up` starts it and `npm run db:test:down` removes it. Each integration run creates and drops its own database, so runs never share state.

## Docker

```bash
npm run docker:up           # build and start web, api, mongo
npm run docker:stop         # stop containers, keep the data volume
```

| Service | Address | Notes |
|---|---|---|
| web | http://127.0.0.1:8080 | nginx, runs as nonroot, proxies `/api` to the API |
| api | http://127.0.0.1:3000 | `/health` liveness, `/health/ready` readiness, `/api/v1/openapi.json` contract |
| mongo | `mongo:27017` (internal only) | Single-node replica set `rs0` for transactions; named volume `dragon-mongo-data`; host port 27017 is deliberately not published |

Migrations and the system seed run automatically as a startup job before the API accepts traffic. Both are idempotent and safe to run from multiple replicas.

Never run `docker compose down -v`: it deletes the database volume. Use `npm run docker:stop`.
