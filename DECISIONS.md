# Project Decisions

Use this file only for material implementation clarifications not already settled in `IMPLEMENTATION_DECISIONS.md`.

## Authority order

1. `IMPLEMENTATION_DECISIONS.md`
2. `Requirements.md`
3. The active staged prompt in `prompts/`
4. Existing repository conventions and tests
5. A small documented assumption, recorded in this file

## Status of approved decisions

Every decision in `IMPLEMENTATION_DECISIONS.md` (DEC-001 … DEC-050) is treated as resolved and none of them blocks implementation. The ones DRAGON-00 acted on directly are DEC-038 (no application-managed backup; persistence and restart evidence still required), DEC-039 and DEC-047 (MongoDB 8.x with Docker Compose, Vue 3 + Vite + TypeScript, Node.js LTS + TypeScript), and DEC-040 and DEC-041 (payment and SMS remain deterministic in-repository mocks, not yet implemented). The remainder constrain later prompts and are recorded in `REQUIREMENTS_TRACEABILITY.md` as they are delivered.

The only open decision touching DRAGON-00 is OD-026; its impact is recorded below.

| Date | Decision | Reason | Affected requirements/prompts |
|---|---|---|---|
| 2026-07-21 | Workspace is npm workspaces with `apps/web` and `apps/api` sharing one root `package-lock.json`. | Deterministic installs from a single lockfile; no extra package-manager dependency. | DRAGON-00 |
| 2026-07-21 | Tests use the built-in `node:test` runner with native TypeScript type stripping; no unit-test framework is added. | The standard library covers the current need; avoids a dependency the repository does not yet require. | TEST-001, DRAGON-00 |
| 2026-07-21 | Locale is a route prefix (`/fa`, `/en`) rather than negotiated routing. | Section 9.1 permits either; a prefix makes direct URL refresh and browser tests deterministic. | I18N-002, TEST-017, DRAGON-00 |
| 2026-07-21 | OD-026 remains unresolved: no analytics or error-monitoring adapter, code, or environment variable exists. | Gated behaviour stays out of scope rather than shipped disabled, so no false integration is presented. | OD-026, INT-007, ANALYTICS-001 |
| 2026-07-21 | `/health` implements liveness only; no readiness endpoint yet. | Section 28.4 limits liveness to process viability, and the API has no dependency to probe until the data layer lands. | DRAGON-01 |
| 2026-07-21 | The API validates `MONGODB_URI` but does not open a MongoDB connection. | DRAGON-00 establishes the service and network boundary; the driver and data model belong to DRAGON-01. | DEC-039, DRAGON-01 |
| 2026-07-21 | API error messages are English at this stage; the envelope carries a stable machine-readable `code`. | Localized API messaging depends on the shared localization layer delivered by DRAGON-02. | API section 15.2, I18N-012, DRAGON-02 |
| 2026-07-21 | Browser tests run on Chromium only. | The full browser and viewport matrix in section 31 is owned by DRAGON-16a; running one real browser satisfies the DRAGON-00 acceptance criterion. | TEST-012, DRAGON-16a |
| 2026-07-21 | The web container uses `nginx-unprivileged` on port 8080. | Satisfies the nonroot container requirement without a custom user setup. | Section 34.2, DRAGON-00 |
| 2026-07-21 | MongoDB runs as a single-node replica set (`rs0`) in the default Compose stack. | MongoDB provides multi-document transactions only on a replica set, and section 32.1 requires atomic transactions. Host port 27017 remains unpublished. | Section 32.1, DEC-039, DRAGON-01 |
| 2026-07-21 | Integration tests use a separate `docker-compose.test.yml` database published on `127.0.0.1:27018` only. **Approved by the repository owner on 2026-07-21** under `IMPLEMENTATION_DECISIONS.md` section 8, conditional on loopback-only binding. | The default Compose file must never publish 27017 and does not. The override is test-only, in-memory, and disposable; binding to loopback keeps it unreachable from the network. Production networking is unchanged. | IMPLEMENTATION_DECISIONS section 8, TEST-003, DRAGON-01 |
| 2026-07-21 | Runtime validation and OpenAPI generation share one JSON Schema source through Fastify and `@fastify/swagger`. | The published contract cannot drift from the contract the server enforces, and no separate schema language is introduced. | Section 32.2, DOC-008, DRAGON-01 |
| 2026-07-21 | Every domain write goes through `runUnitOfWork`, which flushes audit rows and outbox events inside the write transaction. | Makes "no feature bypasses audit correlation or the repository boundary" a structural property rather than a review reminder. | EVENT-001, AUDIT-002, DRAGON-01 |
| 2026-07-21 | Module dependency rules are enforced by ESLint `no-restricted-imports` zones. | A documented boundary that nothing checks is a boundary that erodes; this fails the lint gate instead. | Section 32.1, DRAGON-01 |
| 2026-07-21 | Money uses JavaScript safe integers with explicit guards, not `bigint` or a decimal library. | Rial amounts at the approved scale stay far inside the safe-integer range, and every constructor rejects unsafe or fractional input. Revisit if an asset ever needs sub-unit scale. | CON-002, DATA-061, DRAGON-01 |
| 2026-07-21 | A failed idempotent attempt deletes its reservation so the key can be retried. | A provider timeout must not permanently burn a client's idempotency key; the alternative is a stuck key requiring manual clearing. | Section 15.1, SEC-020, DRAGON-01 |
| 2026-07-21 | Database sources avoid TypeScript parameter properties and other non-strippable syntax. | Node runs these sources directly via native type stripping for tests and development; parameter properties fail at load time. | DRAGON-01 |
