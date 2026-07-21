# Requirements Traceability

This file starts empty. Add or update mappings only when an implementation prompt changes requirement coverage.

Row fields follow Requirements section 37, so the seeded five-column table was widened when DRAGON-00 added the first rows. Allowed statuses: Not started, In progress, Implemented, Verified, Deferred by phase, Blocked by open decision, Not applicable with approved reason. A requirement is marked Verified only when a listed command reproduces the evidence.

Verification commands referenced below:

- `C1` — `npm test`
- `C2` — `npm run e2e`
- `C3` — `npm run verify:persistence`
- `C4` — `npm run typecheck`
- `C5` — `npm run docker:up` followed by `docker compose ps`

| Requirement ID | Summary | Phase tags | Status | Implementation | Schema evidence | Automated tests | Browser tests | Verification command | Evidence | Reviewer | Review status | Open decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| I18N-001 | Persian and English are the supported locales | FOUNDATION | Verified | `apps/web/src/i18n/locale.ts`, `apps/api/src/server.ts` | None | `locale.test.ts`, `server.test.ts` | `foundation.spec.ts` | C1, C2 | 19 unit tests and 5 browser tests pass | Pending | Pending | — |
| I18N-002 | Initial locale detected from browser preference | FOUNDATION | Verified | `apps/web/src/i18n/locale.ts` | None | `locale.test.ts` | — | C1 | Base-language matching covered | Pending | Pending | — |
| I18N-003 | Unsupported or missing preference falls back to Persian | FOUNDATION | Verified | `apps/web/src/i18n/locale.ts` | None | `locale.test.ts`, `server.test.ts` | — | C1 | Fallback asserted for unknown and empty input | Pending | Pending | — |
| I18N-005 | Runtime language switching is supported | FOUNDATION | Verified | `apps/web/src/App.vue`, `apps/web/src/router.ts` | None | — | `foundation.spec.ts` | C2 | Switch test asserts lang and dir change | Pending | Pending | — |
| I18N-006 | Locale persists as a client preference when anonymous | FOUNDATION | Implemented | `apps/web/src/i18n/index.ts` | None | `locale.test.ts` | — | C1 | Stored preference wins over browser preference; authenticated persistence needs accounts | Pending | Pending | DRAGON-03 |
| I18N-007 | Route is preserved when switching language | FOUNDATION | Verified | `apps/web/src/router.ts` | None | — | `foundation.spec.ts` | C2 | Same route retained across switch | Pending | Pending | — |
| I18N-008 | UI strings are not hardcoded in components | FOUNDATION | Implemented | `apps/web/src/**/*.vue` | None | `locales.test.ts` | `foundation.spec.ts` | C1, C2 | All rendered text resolves through `t()` | Pending | Pending | — |
| I18N-009 | Raw translation keys never appear in production UI | FOUNDATION | Verified | `apps/web/src/i18n/index.ts` | None | `locales.test.ts` | `foundation.spec.ts` | C1, C2 | Missing-key handler returns a safe value; browser test asserts no key pattern | Pending | Pending | — |
| I18N-010 | Automated checks detect missing required keys | FOUNDATION | Verified | `apps/web/src/i18n/locales/*.json` | None | `locales.test.ts` | — | C1 | Key-set parity, empty-value, and Persian-content checks | Pending | Pending | — |
| TEST-011 | Localization tests validate key completeness | FOUNDATION | Verified | `apps/web/src/i18n/locales.test.ts` | None | `locales.test.ts` | — | C1 | 3 localization tests pass | Pending | Pending | — |
| TEST-012 | Browser tests run major journeys in fa RTL and en LTR | FOUNDATION | In progress | `apps/web/e2e/foundation.spec.ts` | None | — | `foundation.spec.ts` | C2 | Foundation journey covered in both locales; Phase 1 journeys not built yet | Pending | Pending | — |
| TEST-015 | Production builds are tested, not only dev servers | FOUNDATION | Verified | `apps/web/playwright.config.ts` | None | — | `foundation.spec.ts` | C2 | Suite runs against `vite preview` of the built bundle | Pending | Pending | — |
| TEST-016 | Docker build, startup, health, shutdown are tested | FOUNDATION | In progress | `apps/api/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.yml` | None | — | — | C5 | All three services reported healthy; migrations and seeds do not exist yet | Pending | Pending | DRAGON-01 |
| TEST-017 | Direct URL refresh works for routes | FOUNDATION | Verified | `apps/web/src/router.ts`, `apps/web/nginx.conf` | None | — | `foundation.spec.ts` | C2, C5 | Locale-prefixed direct entry returns 200 through nginx | Pending | Pending | — |
| TEST-019 | Browser runs assert no unexpected console or network errors | FOUNDATION | Verified | `apps/web/e2e/foundation.spec.ts` | None | — | `foundation.spec.ts` | C2 | console, pageerror, and requestfailed listeners assert empty | Pending | Pending | — |
| TEST-025 | MongoDB data survives Compose stop/start | FOUNDATION | Verified | `scripts/mongo-persistence-check.mjs`, `docker-compose.yml` | Named volume `dragon-mongo-data` | — | — | C3 | Marker document identical before and after restart | Pending | Pending | — |
| OPS-004 | Persistence restart evidence is current | FOUNDATION | Verified | `scripts/mongo-persistence-check.mjs` | Named volume `dragon-mongo-data` | — | — | C3 | Same run as TEST-025 | Pending | Pending | — |
| SEC-008 | Secure response headers | FOUNDATION | In progress | `apps/api/src/server.ts`, `apps/web/nginx.conf` | None | `server.test.ts` | — | C1, C5 | Baseline nosniff, frame, and referrer headers; CSP and transport controls owned by DRAGON-16b | Pending | Pending | DRAGON-16b |
| SEC-012 | Logs redact credentials and sensitive data | FOUNDATION | In progress | `apps/api/src/server.ts` | None | — | — | C4 | authorization, cookie, and set-cookie redacted; OTP and token redaction arrives with DRAGON-03 | Pending | Pending | DRAGON-03 |
| SEC-018 | Error responses disclose no internals | FOUNDATION | Verified | `apps/api/src/server.ts` | None | `server.test.ts` | — | C1 | 5xx returns a generic message with a correlation ID | Pending | Pending | — |
| DEC-038 | No application-managed backup or restore | FOUNDATION | Implemented | `scripts/mongo-persistence-check.mjs` | None | — | — | C3 | Check only stops and starts; no backup service exists | Pending | Pending | — |
| DEC-039 | MongoDB 8.x is the required database | FOUNDATION | Implemented | `docker-compose.yml` | Service `mongo`, image `mongo:8.0` | — | — | C3, C5 | Healthy and internally addressable as `mongo:27017`; driver lands in DRAGON-01 | Pending | Pending | DRAGON-01 |
| DEC-047 | Required stack is Compose, Vue 3 + Vite + TS, Node.js + TS, MongoDB 8.x | FOUNDATION | Implemented | `apps/web`, `apps/api`, `docker-compose.yml` | Service `mongo` | full `C1` suite | `foundation.spec.ts` | C1, C2, C5 | Full stack builds and runs | Pending | Pending | — |
| DOC-001 | README with product and module overview | FOUNDATION | Implemented | `README.md` | None | — | — | — | Document present | Pending | Pending | — |
| DOC-002 | Local development setup | FOUNDATION | Implemented | `README.md` | None | — | — | — | Documented commands executed during this prompt | Pending | Pending | — |
| DOC-003 | Docker and Compose guide | FOUNDATION | Implemented | `README.md` | None | — | — | C5 | Documented commands executed | Pending | Pending | — |
| DOC-004 | Environment-variable reference | FOUNDATION | Implemented | `ENVIRONMENT_VARIABLES.md` | None | — | — | — | All section 34.5 fields present | Pending | Pending | — |
| DOC-007 | Architecture and module-boundary overview | FOUNDATION | Implemented | `ARCHITECTURE.md` | None | — | — | — | Boundaries listed; modules not yet built | Pending | Pending | — |
| DOC-022 | REQUIREMENTS_TRACEABILITY.md exists and is maintained | FOUNDATION | Implemented | This file | None | — | — | — | Populated by DRAGON-00 | Pending | Pending | — |
| OD-026 | Analytics and error-monitoring tool selection | FOUNDATION | Blocked by open decision | None | None | — | — | — | No adapter, code, or environment variable exists; feature stays out of scope | Pending | Pending | OD-026 |
