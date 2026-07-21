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

## 5. Shared kernel

`apps/api/src/shared` holds what every module depends on and what no module may bypass.

| Concern | Module | Contract |
|---|---|---|
| Identity | `ids.ts` | Opaque UUID public IDs, never reused, validated at boundaries. |
| Money | `money.ts` | `{assetCode, amountInteger, scale}`. Integer minor units only; `IRR` and `DRC` both whole-unit. Toman converts at 10 rial and keeps any remainder. |
| Events | `events.ts` | Full section 5.9 envelope: event ID, name, version, aggregate, occurred-at, producer, correlation, causation, payload. |
| Audit | `audit.ts` | Append-only record with actor, resource, before/after, reason, correlation. |
| Context | `context.ts` | Correlation ID plus actor, attached to every request before any handler runs. |
| Errors | `errors.ts` | One envelope for every failure; 5xx detail never reaches a client. |
| Jobs | `jobs.ts` | Handler and execution-record contracts. Worker and scheduler are DRAGON-14. |

### The write path

Every domain write goes through `runUnitOfWork`. It opens a transaction, exposes the session and request context, and flushes queued audit rows and domain events inside that same transaction. A committed change therefore always has its audit trail and its outbox event, and a rolled-back change leaves neither. Writing to a collection outside a unit of work bypasses audit correlation and is a review failure.

## 6. Data foundation

| Collection | Purpose |
|---|---|
| `schema_migrations` | Applied migration versions and state. |
| `audit_events` | Append-only audit trail (DATA-083). |
| `domain_event_outbox` | Transactional outbox (DATA-084). |
| `idempotency_keys` | One stored outcome per scope and key; TTL-expired. |
| `job_executions` | Background job execution records (DATA-085). |
| `role_definitions` | Seeded role catalogue; permissions filled in by DRAGON-04. |

Indexes are declared in `shared/db/collections.ts` and created by the migration that owns them, so the declaration and the database cannot drift. An integration test asserts every declared index exists with its unique and TTL options applied.

### Migrations and seed

`npm run migrate` is the explicit release step; the same work also runs as a controlled startup job before the server accepts traffic. Both paths are idempotent and safe across replicas: a runner claims a version with a unique insert, so a second replica skips rather than repeating the migration. The seed contains system configuration and roles only — never demonstration data.

### Transactions

MongoDB offers multi-document transactions only on a replica set, and section 32.1 requires atomic transactions, so Compose runs a single-node replica set (`rs0`). Integration tests prove both commit and rollback behaviour.

## 7. Persistence

MongoDB stores data on the named volume `dragon-mongo-data`. `npm run verify:persistence` proves committed data survives an ordinary Compose stop/start (TEST-025, OPS-004). There is no application-managed backup or restore workflow (DEC-038); the check never removes volumes.

## 8. Domain modules

`apps/api/src/modules` holds one directory per boundary from section 32.1. None exist yet; DRAGON-03 onwards adds them. Three dependency rules are enforced by ESLint rather than convention:

1. A module never imports another module's internals — access goes through that module's public `index.ts`.
2. A module never reads or writes another module's collections.
3. The shared kernel never imports a domain module; dependencies point inward only.

## 9. What the foundation deliberately does not include

Authentication and sessions (DRAGON-03), the authorization evaluator that consumes `RequestContext` (DRAGON-04), the outbox dispatcher and job worker (DRAGON-14), the ledger and its balanced postings (DRAGON-11), localized API error messages (DRAGON-02), and every domain module. The kernel provides the boundaries these will plug into; it does not anticipate their business rules.
