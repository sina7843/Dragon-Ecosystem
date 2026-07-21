# Dragon Ecosystem Architecture

Status: foundation established by DRAGON-00. Domain modules arrive in later prompts.

## 1. Authority order

Implementation follows this precedence (CLAUDE.md, `IMPLEMENTATION_DECISIONS.md` section 1):

1. `IMPLEMENTATION_DECISIONS.md`
2. `Requirements.md`
3. The active staged prompt in `prompts/`
4. Existing repository conventions and tests
5. A small documented assumption, recorded in `DECISIONS.md`

A lower-priority document never weakens an approved security, privacy, financial, or product decision.

## 2. Shape

A modular monolith with two deployables and one database (ASM-014, section 32.1):

```
browser ──► web (nginx, static Vue bundle)
              │  same-origin /api/* proxy
              ▼
            api (Node.js + Fastify)
              │  internal network only
              ▼
            mongo (MongoDB 8.x, named volume)
```

- `apps/web` — Vue 3 + Vite + TypeScript. Ships a static bundle; no server rendering.
- `apps/api` — Node.js + Fastify + TypeScript. Owns every authorization decision.
- `mongo` — MongoDB 8.x (DEC-039, DEC-047). Reachable only as `mongo:27017` on the Compose network.

The browser always calls a same-origin `/api` path. Vite proxies it in development, nginx proxies it in containers, so no API origin is compiled into the bundle.

## 3. Planned module boundaries

Section 32.1 requires these domain boundaries. None are implemented yet; they define where later prompts add code, and modules must not read another module's collections directly:

identity · profile · content · games · teams · tournaments · competition · notifications · moderation · media · payments · ledger · education · social · commerce · operations

## 4. Foundation decisions in force

| Area | Decision |
|---|---|
| API surface | Versioned under `/api/v1` (section 15.1). `/health` sits outside the versioned surface. |
| Errors | Single envelope: `code`, `message`, `fieldErrors`, `correlationId`, `retryable` (section 15.2). Server messages are never leaked for 5xx (SEC-018). |
| Correlation | Every request carries `x-correlation-id`, inbound value preserved, echoed on the response (section 28.1). |
| Configuration | Validated at startup; production fails fast on a missing `MONGODB_URI` (section 32.3). |
| Health | `/health` is liveness only (section 28.4). Readiness arrives with the first real dependency in DRAGON-01. |
| Locales | `fa` and `en`; Persian is the fallback; locale is a route prefix (`/fa`, `/en`) so direct URL refresh works. |
| Money | Not yet implemented. When it arrives it uses integer rial with a Money contract; no binary floating point (CON-002). |
| Providers | Payment and SMS stay deterministic in-repository mocks behind adapters (DEC-040, DEC-041). |

## 5. Persistence

MongoDB stores data on the named volume `dragon-mongo-data`. `npm run verify:persistence` proves committed data survives an ordinary Compose stop/start (TEST-025, OPS-004). There is no application-managed backup or restore workflow (DEC-038); the check never removes volumes.

## 6. What DRAGON-00 deliberately does not include

The data model, outbox, jobs, migrations, authentication, authorization, and every domain module. DRAGON-01 owns the shared architecture contracts and data foundation. The API does not yet open a MongoDB connection — the service and its network boundary exist, the driver does not.
