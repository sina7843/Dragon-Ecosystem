# Implementation Status

## Current state
- Repository foundation: complete (DRAGON-00)
- Data and contract foundation: complete (DRAGON-01)
- Design system, shell, and localization: complete (DRAGON-02)
- Active prompt: DRAGON-03 — OTP authentication, sessions, and account profile
- Latest verified checkpoint: DRAGON-02 application shell and design system, 2026-07-21

## Delivered by DRAGON-00
- npm workspace with `apps/web` (Vue 3 + Vite + TypeScript) and `apps/api` (Node.js + Fastify + TypeScript), one root lockfile, and root scripts for typecheck, lint, test, build, and E2E.
- Bilingual `fa` RTL and `en` LTR route with locale detection, Persian fallback, runtime switching, and a translation-completeness check.
- API with validated startup configuration, `/health` liveness on port 3000, correlation IDs, and the section 15.2 error envelope.
- Compose stack `web`, `api`, `mongo`; nonroot runtime images; MongoDB on the named volume `dragon-mongo-data`, internal-only as `mongo:27017`.
- Governance artifacts: `ARCHITECTURE.md`, `ENVIRONMENT_VARIABLES.md`, `README.md`, `.dockerignore`, and populated `DECISIONS.md` and `REQUIREMENTS_TRACEABILITY.md`.

## Delivered by DRAGON-01
- Shared kernel: opaque UUID IDs, Money value contract on integer rial and whole Dragon Coin, domain-event envelope, audit envelope, request context, and the shared error hierarchy.
- Mongo access layer: connection management, transaction helper, ordered and race-safe migration runner with version tracking, declared indexes, idempotent system seed (28 roles), and per-run test database isolation.
- Transactional outbox, idempotency store with concurrency-safe replay, and job interfaces.
- Versioned `/api/v1` routing, JSON Schema validation, OpenAPI 3.1 at `/api/v1/openapi.json`, and `/health/ready` backed by a real Mongo ping.
- Module dependency rules enforced by ESLint; `runUnitOfWork` makes audit and outbox writes structural rather than optional.
- MongoDB runs as a single-node replica set so transactions are available.

## Delivered by DRAGON-02
- Design tokens for colour, typography, spacing, radius, elevation, motion, z-index, and breakpoints, with light and dark themes whose contrast is verified against WCAG AA by parsing the stylesheet.
- One application shell serving the public, account, and administration areas: responsive navigation that collapses below 768px, skip link, landmarks, locale switcher, theme control, and a polite notification region.
- Shared states — loading, empty, error, forbidden, not found — plus accessible dialog, form field, table, and pagination components built on native platform behaviour.
- Localization architecture: semantic keys, browser detection with Persian fallback, stored preference, runtime switching that preserves the route, `lang`/`dir` handling, locale-aware dates, numbers, and Toman display, digit normalization, and a completeness check that fails the build.
- Document head handling for localized titles, canonical, hreflang, and `noindex` on account and administration routes.

## Known blockers
- None.

## Deferred with an owner
- Localized API error messages — DRAGON-03 onwards, alongside the first real endpoints.
- OTP, sessions, account-level locale and theme persistence, and full log redaction — DRAGON-03.
- Authorization evaluator consuming `RequestContext`, and audit read APIs — DRAGON-04.
- Ledger, balanced postings, reversals, and reconciliation — DRAGON-11.
- Outbox dispatcher, job worker and scheduler, dead-letter handling — DRAGON-14.
- Full security header set, CSP, and CORS allowlist — DRAGON-16b.
- Full browser and viewport matrix from Requirements section 31 — DRAGON-16a.
- OD-026 analytics and error monitoring — unresolved; no adapter exists.

## Last verification
2026-07-21, all commands run from the repository root:
- `npm run typecheck` — pass
- `npm run lint` — pass, 0 problems
- `npm test` — 73 passed (37 api, 36 web)
- `npm run test:integration` — 15 passed
- `npm run build` — pass
- `npm run e2e` — 93 passed across small-mobile 320px, mobile 375px, and desktop 1440px, in fa RTL and en LTR
- `npm run verify:persistence` — pass (DRAGON-01 run)
- `npm run docker:up` — web, api, mongo all healthy; migrations applied and 28 roles seeded in the container; readiness 200 (DRAGON-01 run)
- Package guardrails: run `03-CHECK-PACKAGE.cmd`.

No independent review pass has run against DRAGON-00, DRAGON-01, or DRAGON-02; the traceability reviewer columns record this as Pending.
