# Implementation Status

## Current state
- Repository foundation: complete (DRAGON-00)
- Data and contract foundation: complete (DRAGON-01)
- Design system, shell, and localization: complete (DRAGON-02)
- Identity, sessions, and profiles: complete (DRAGON-03)
- Authorization, administration, audit, configuration: complete (DRAGON-04)
- Active prompt: DRAGON-05 — content CMS and game catalog
- Latest verified checkpoint: DRAGON-04 RBAC, administration, and audit, 2026-07-22

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

## Delivered by DRAGON-03
- Iranian mobile normalization to E.164 from nine accepted input forms, including Persian and Arabic-Indic digits, with masked presentation for logs and delivery records.
- OTP request, resend interval, expiry, attempt cap, single use, and per-mobile and per-IP rate limits. Codes are stored only as keyed hashes and never appear in a delivery record or a log.
- Anti-enumeration across the OTP endpoints: identical responses for known and unknown numbers, one generic failure for every unsuccessful verification.
- Sessions in an httpOnly cookie with a hashed token, per-session and global revocation, logout, a recent-authentication window, and recorded security events the user can review.
- Deterministic mock SMS provider with a development-and-test-only inbox route that does not exist in production; email adapter boundary present but delivery disabled.
- Account state machine with audited transitions, suspended accounts blocked from protected routes.
- Profile completion with username normalization and uniqueness, minimum age 13, locale and time zone preferences, privacy-by-default visibility, and a public player identity that returns 404 while private.
- Bilingual sign-in, profile, and security pages with server error codes mapped to localized messages.

## Delivered by DRAGON-04
- Deny-by-default RBAC: a pure permission catalogue and policy evaluator (`shared/authz`), role→permission mapping owned by code and enforced by the seed, and resource-scoped role assignments that prevent IDOR and privilege escalation.
- Administration API under `/api/v1/admin`: masked paginated user list, suspend/reactivate, role assign/revoke with an escalation guard, versioned configuration with dual control for high-risk finance/security keys, and immutable audit search, export, and an emergency oversight queue.
- Every high-risk mutation writes an audit event in the same transaction; super-administrator actions are flagged emergency; audit export records its own event.
- Capability-driven administration frontend: overview, users (suspend/reactivate), and audit (search/export) pages that render from effective permissions and show the forbidden state otherwise, bilingual.
- 26 authorization-matrix integration tests (401/403/404, IDOR, escalation, dual control, audit, emergency) and browser tests for the forbidden UI in both locales.

## Known blockers
- None.

## Deferred with an owner
- Bootstrap of the first super administrator (no seeded admin account) — deferred to deployment/runbook; documented as a risk.
- Bulk admin actions with preview (ADMIN-004) and configuration diff UI — later admin prompts.
- Account recovery — blocked by OD-029; nothing partial is exposed.
- Verified email — blocked by OD-003; adapter boundary only.
- Reserved usernames and change-frequency policy — blocked by OD-028.
- Account-level locale and theme persistence beyond the stored preferences — DRAGON-04 onwards.
- Full log redaction review and CSRF tokens — DRAGON-16b.
- Authorization evaluator consuming `RequestContext`, and audit read APIs — DRAGON-04.
- Ledger, balanced postings, reversals, and reconciliation — DRAGON-11.
- Outbox dispatcher, job worker and scheduler, dead-letter handling — DRAGON-14.
- Full security header set, CSP, and CORS allowlist — DRAGON-16b.
- Full browser and viewport matrix from Requirements section 31 — DRAGON-16a.
- OD-026 analytics and error monitoring — unresolved; no adapter exists.

## Last verification
2026-07-22, all commands run from the repository root:
- `npm run typecheck` — pass
- `npm run lint` — pass, 0 problems
- `npm test` — 128 passed (92 api, 36 web)
- `npm run test:integration` — 62 passed (includes 27 authorization-matrix tests)
- `npm run build` — pass
- `npm run e2e` — 144 passed across small-mobile 320px, mobile 375px, and desktop 1440px, in fa RTL and en LTR
- `node --test .claude/tests/guardrails.test.mjs` — 7 passed
- `npm run verify:persistence` — pass (DRAGON-01 run)
- `npm run docker:up` — web, api, mongo all healthy; migrations applied and 28 roles seeded (DRAGON-03 run)
- Package guardrails: run `03-CHECK-PACKAGE.cmd`.

DRAGON-03's proxy-trust security finding was reviewed, fixed, and re-checked (PASS); those rows are marked Reviewed. DRAGON-04 (security-sensitive RBAC) had one focused `test-reviewer` security pass: verdict PASS, no Critical/High. One Medium/plausible finding — a config-key case variant could dodge high-risk dual-control classification — was fixed by canonicalising keys, with unit and integration regression tests. Rows from DRAGON-00 through DRAGON-02 remain Pending for review.
