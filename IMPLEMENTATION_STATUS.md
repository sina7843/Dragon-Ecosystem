# Implementation Status

## Current state
- Repository foundation: complete (DRAGON-00)
- Data and contract foundation: complete (DRAGON-01)
- Design system, shell, and localization: complete (DRAGON-02)
- Identity, sessions, and profiles: complete (DRAGON-03)
- Authorization, administration, audit, configuration: complete (DRAGON-04)
- Content CMS and game catalog: complete (DRAGON-05)
- Persistent teams and gaming identities: complete (DRAGON-06)
- Tournament authoring and discovery: complete (DRAGON-07)
- Registration, eligibility, approval, and waitlist: complete (DRAGON-08) — implemented and verified, not yet committed
- Competition core (single-elimination + round-robin): complete (DRAGON-09a) — implemented and verified, not yet committed
- Advanced competition formats (double elimination, Swiss, manual/custom): complete (DRAGON-09b) — implemented and verified, not yet committed
- Active prompt: DRAGON-09c — standings and concurrency
- Latest verified checkpoint: DRAGON-09b advanced formats, 2026-07-22

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
- Authorization-matrix integration tests (401/403/404, IDOR, escalation, dual control, audit, emergency) and browser tests for the forbidden UI in both locales.
- One-time super-administrator bootstrap: a CLI entry point (`bootstrap:superadmin`, no HTTP surface) that grants the first super admin to an existing account, refuses once one exists, and writes an emergency audit event. Procedure documented in `RUNBOOKS.md`.

## Delivered by DRAGON-05
- Content module: six content types (news, article, announcement, guide, rules, page) as bilingual translation-group records; draft → in_review → published → archived lifecycle with scheduling; publication blocked unless both locales are complete; append-only version history; optimistic concurrency; categories and tags.
- Rich content sanitised on write (strict allowlist); the public read path serves already-safe HTML; drafts and scheduled items never leak.
- Games module: bilingual catalog with slug, SEO, lifecycle, and archive (never destructive delete).
- Public read side: content hub with type filter and pagination, content detail with per-locale slug and SEO (title, description, canonical, hreflang using the correct localized slug, Open Graph), games catalog and detail, real 404s.
- Admin: content management with a bilingual editor and lifecycle controls (publisher-only publish/archive), games management, capability-driven navigation.
- Backend tests (slug/sanitize/state unit; content and games integration for authz, publication rules, drafts-not-public, concurrency) and bilingual browser journeys (publish → public in both locales, SEO assertions, draft-404).

## Delivered by DRAGON-06
- Persistent teams module (`modules/teams`): create/edit/view teams with a unique normalized slug, a private-by-default visibility, and a reference to a published game-catalog record; owner and member roles held per membership (a resource-scoped grant, not a fixed team-role column, so Phase 4 delegation is additive — TEAM-002/012).
- Membership and invitation lifecycles: invite by username, accept (idempotent), decline, lazy expiry, remove, and voluntary leave, with membership history retained via effective `joinedAt`/`leftAt` dates.
- Race safety is enforced by partial unique indexes inside the write transaction, never read-before-write alone: one active membership per (team, account), exactly one active owner per team, and one pending invitation per (team, account). Ownership transfer is an atomic demote/promote guarded by the one-active-owner index and conditional filters, so concurrent transfers still leave exactly one owner.
- Every high-risk mutation writes its audit event in the same transaction through `runUnitOfWork`; the owner cannot leave or be removed (transfer or disband first); disbanding archives the team without destroying membership history.
- Immutable, append-only roster snapshots for later tournament registration and match history (BR-007, ASM-004), plus a historical roster reconstruction from membership effective dates.
- Game-specific player identities (in-game name per game) with privacy-aware public views: a public team lists only public-profile members, and a private profile hides its gaming identities entirely.
- Identity module extended with cross-module lookups (username → account id, batch identity summaries, public-only identities, public-profile check) so teams never read identity collections directly (section 32.1).
- Bilingual (fa RTL / en LTR) team hub, team detail with owner/member controls, gaming-identity management, and a public team page; router, navigation, and locale bundles updated with full key parity.
- A single focused `test-reviewer` pass on the ownership/invitation/membership authorization and concurrency paths returned APPROVE with no Critical or High findings. Two low-risk notes were applied (slug is now stable across renames unless explicitly changed; `listTeamInvitations` returns 404 for an unknown team before 403 for a non-owner); the remaining notes were benign read-only consistency windows with no invariant impact.

## Delivered by DRAGON-07
- Tournament-definition module (`modules/tournaments`): bilingual translation-group records with a game reference, individual/team participant type, capacity capped at 1,000 (DEC-046), registration and schedule dates, format family (single/double elimination, round robin, Swiss, custom), custom rules, eligibility, approval mode, waitlist mode, entry fee, refund policy, prizes, and versioned custom questions.
- Fee definitions (TOURN-012) for free, Toman, Dragon Coin, or fixed mixed pricing, held as exact integer `Money` (Toman stored as rial ×10, Dragon Coin as whole units) with no floating-point math; a domain ceiling keeps every amount a safe integer. No payment is executed — these are priced definitions only.
- Versioned prize definitions (Toman and/or Dragon Coin per placement) and a versioned custom-question set: each carries its own version counter that bumps only when the set actually changes, so later submitted answers can be stamped with the question version (TOURN-007).
- Lifecycle (draft → published, with cancel, archive, and a reserved `completed` state owned by DRAGON-09): draft validation that lists every missing mandatory value at once (TOURN-002), cross-field date ordering (registration opens < closes ≤ start < end), preview, clone, optimistic-concurrency edits restricted to drafts, and append-only revision history plus an audit event written atomically with each change.
- Public discovery: list (upcoming first), detail by slug, and a calendar within a date range — all restricted to published tournaments; a draft/cancelled/archived tournament is a real 404 and the internal question set is never exposed publicly (TOURN-029).
- Capability-driven tournament administration UI (authoring form, lifecycle controls, clone, preview) gated on `tournament.manage`, and bilingual public list, detail, and calendar views; router, navigation, admin capabilities, and locale bundles updated with full key parity.
- OD-006 handled by feature-gate: no approved game/publisher/federation rule profiles are shipped, so tournaments use custom free-text rules (always publishable) and named external profiles stay out of scope until OD-006 resolves.
- Authoring authority uses the existing global `tournament.manage` permission (any holder manages any tournament), matching the content and games modules; resource-scoped organizer/referee ownership is deferred to DRAGON-08 operations.
- One focused `test-reviewer` pass over money handling, publication gating, authorization, and lifecycle: verdict APPROVE, no Critical/High. Two Medium notes were addressed — money amounts now have a domain ceiling so an oversized fee is a clean 422 rather than an overflow 500, and publication now aggregates missing-value and date-order problems together.

## Delivered by DRAGON-08
- Registration module (`modules/registrations`): individual and team registration for published, free tournaments, with eligibility evaluation (participant-type match, registration window, complete-profile, minimum age, in-game identity), versioned custom-question answers stamped with the question-set version (TOURN-007), and immutable answers.
- Database-enforced invariants (never read-before-write): capacity is claimed by an atomic conditional `$inc` on a per-tournament seat counter (`mainCount < capacity`, capacity frozen at publish) so concurrent final-slot requests cannot overbook (TOURN-005); a partial unique index on `(tournamentId, subjectId) where active:true` guarantees one active registration per participant, so concurrent duplicates collapse to one active entry and one conflict (TOURN-009); `withIdempotency` makes a replayed submit return the same registration (TOURN-013); waitlist positions come from a monotonic `$inc`, giving deterministic, unique ordering (TOURN-006).
- Team registration is owner-only and captures an immutable roster snapshot via the teams module (reusing `captureRosterSnapshot`, which enforces ownership and an active team) — TOURN-009/TOURN-010.
- Approval workflow: automatic approval seats immediately (or waitlists when full and enabled, else rejects as full); manual approval creates a pending entry and an administrator approves (claims a seat), rejects with a required reason, waitlists, promotes a waitlisted entry, or cancels; cancelling or rejecting an approved entry releases its seat (which an administrator then fills by promotion — no auto-promote). Every decision writes an audit event and a domain event to the outbox in the same transaction.
- Administration queue is resource-scoped: routes are nested under `/admin/tournaments/:id/registrations` and gated on `tournament.manage` scoped to that tournament, so a resource-scoped organizer/referee operates only their own tournament and cannot reach another's (IDOR closed, TOURN-018); the queue is filterable and cursor-paginated with a seat summary — bounded queries at the 1,000 scale.
- Participant status endpoint plus a bilingual public registration panel (register, live status, withdraw) on the tournament detail, and a bilingual admin registration queue (approve/reject/waitlist/promote/cancel) with a seat summary.
- OD-007: paid registration and refund execution stay disabled — a non-free tournament rejects registration with `PAYMENT_NOT_AVAILABLE` until DRAGON-11/12.
- One focused `test-reviewer` pass over concurrency, authorization, IDOR, waitlist promotion, duplicate prevention, and capacity enforcement: verdict APPROVE, no Critical/High. One Low DRY note was applied (the active-flag now derives from `isActiveState`). One Medium note is a property of the shared `withIdempotency` helper (completion is not written inside the registration transaction): a process crash in a narrow window can leave an idempotency key `in_progress` until its 24h TTL, but this can never overbook or create a duplicate (the seat counter and active-unique index still hold), so it is recorded as a known limitation rather than changed here (rewriting shared infrastructure is out of scope).

## Delivered by DRAGON-09a
- Pure, deterministic competition engine (`modules/competitions/engine.ts`): reproducible seeding (a caller-supplied manual order, else a stable sort by a keyed SHA-256 of the seed and participant id — order-independent, no RNG/clock), standard balanced bracket seeding, single-elimination generation with correct byes for non-power-of-two counts (byes assigned to top seeds and pre-advanced), and round-robin scheduling by the circle method (every pairing once per leg, one rest per round for odd counts, home/away alternating by leg). Match `key`s are logical/positional so the structure is stable and property-testable; opaque ids are assigned on persistence.
- Configuration validation (`validation.ts`): rejects unsupported formats (double elimination, Swiss, manual/custom are validated as unsupported here — delivered by DRAGON-09b), duplicate participants, and participant counts outside each format's limits (single elimination 2–1000, round robin 2–64 synchronous; larger round robin via a background job is DRAGON-09c), before any generation.
- Competition service (`service.ts`): generates a competition from a tournament's **approved** registrations only (the authoritative participant source), carrying each team entry's immutable registration-time roster snapshot into its match slots (TOURN-010); records match results with deterministic single-elimination advancement.
- Database and concurrency guarantees: one competition per tournament via a unique index on `tournamentId` (concurrent generation collapses to one, no duplicate state); results recorded under an optimistic `(version, state:ready)` guard so concurrent progression on a match yields one success and one conflict, a result is applied at most once (idempotent replay of the same result, conflict on a different one), and a match never advances without an accepted result (byes are the only structural pre-advance). Every write goes through `runUnitOfWork` (transactional audit + outbox event); persisted competitions and matches use stable opaque ids; no floating-point or money behavior.
- Scope boundary: this slice adds no user-facing UI and no HTTP surface — bracket administration and operational control UI are later slices/prompts (09b/09c/10), so the browser suite is unchanged. Authorization is preserved unchanged (the service carries the request context for audit; the gated HTTP surface arrives with the control UI).

## Delivered by DRAGON-09b
- Double-elimination engine (`modules/competitions/double-elimination.ts`): deterministic winners and losers brackets built from a slot-source graph. A winners-bracket loser drops to a fixed losers-bracket fixture, a losers-bracket loser is eliminated (a second loss), byes are modelled as permanently-empty slots that advance structurally without counting as a loss (non-power-of-two counts produce a valid bracket), and the two bracket champions meet in a **single** grand final. Validated by an independent play-out simulator for n=2..32 (single champion, no participant exceeds two losses, no self-play, no duplicate per round).
- Swiss engine (`swiss.ts`): round-incremental deterministic pairing — score groups by accepted-result wins, ordered by score then seed, paired by a backtracking matching that avoids prior pairings when a rematch-free perfect matching exists and falls back deterministically otherwise; odd counts give one bye (no fabricated opponent) to the player with the fewest prior byes, then the lowest score, then the lowest seed. The next round is generated only after the current round completes; a unique key index makes concurrent generation of a round collapse to one.
- Manual / custom format (`manual.ts`): a validated declarative competition graph (data, never executable code — OD-006). Validation rejects duplicate fixture keys, out-of-range or reused participant seeds, missing/invalid downstream targets, self-dependency, self-pairing, conflicting downstream writers, orphan slots, cycles (Kahn), and size/depth beyond bounds; a result can only ever propagate inside the validated graph.
- Service (`service.ts`): format-dispatched generation, deterministic single-elimination/double-elimination/manual advancement (winner → next, loser → losers bracket / manual loser slot) with a bye cascade (`#fillCascade`) for empty-sibling walkovers, and `generateSwissRound` from accepted results. Matches now carry a logical `key`, `bracket` side, empty-slot markers, and loser-routing; the competition stores its seeded participants (with roster snapshots) and Swiss progression.
- Database safeguards: a unique `(competitionId, key)` index makes logical fixture keys unique within a competition and is the authority that collapses concurrent Swiss-round (and duplicate manual/bracket) generation to one; the existing unique `tournamentId` still enforces one competition per tournament; results stay under the optimistic `(version, state:ready)` guard.
- Gated policies (recorded, not invented): the double-elimination grand-final **reset** variant and the exact Swiss **bye scoring / tiebreak** are defined by rule profiles, which OD-006 keeps gated (BRACKET-007); this slice ships a single grand final and a bye-counts-as-a-win default and gates the alternatives. Synchronous size limits: single elimination ≤1000, double elimination ≤256, round robin ≤64, Swiss ≤16, manual ≤256 fixtures / depth ≤32.
- One focused `test-reviewer` pass over double-elimination routing, Swiss rematch/bye invariants, custom-graph validation, result idempotency, concurrency, and resource-scoped authorization: verdict APPROVE, no Critical/High. One correctness Medium was fixed — the manual graph now rejects reusing a participant seed across fixtures (which could double-book a participant or route the same participant into both sides of a later fixture). No routes/UI were added, so authorization is unchanged from 09a.

## Known blockers
- None.

## Deferred with an owner
- Media upload/scan/derivative pipeline (MEDIA-001..015) — DRAGON-15; content/games reference a validated cover-image URL until then.
- Scheduled-publish notification/index job and locale-aware full-text search — DRAGON-13/15.
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
- Final standings and tiebreaker presentation, large-scale (1,000) background generation, bracket locking/rollback/regeneration and preview, and the operational control/bracket-admin UI (BRACKET-010/012/013/014/015/017) — DRAGON-09c/10; the deterministic engines and result-driven progression are in place.
- Double-elimination grand-final reset and exact Swiss bye-scoring/tiebreak (rule-profile-defined) — gated by OD-006/BRACKET-007; single grand final and bye-as-win defaults ship today.
- Manual group/round-robin-style graphs with a participant appearing in multiple fixtures — deferred; the manual graph currently seeds each participant once (elimination/bracket-style), which prevents downstream self-play.
- Tournament match scheduling, results, corrections, and outcomes (TOURN-019..025), and cancellation/completion cleanup workflows (TOURN-027/028) — DRAGON-09/10.
- Outbox dispatcher and notification delivery — registration emits domain events to the outbox; the dispatcher and mock-SMS/notification delivery are DRAGON-13/14.
- Paid tournament registration and refund execution (OD-007) — gated off; a non-free tournament rejects registration until DRAGON-11/12.
- Eligibility revaluation on roster change and staff/referee resource assignment beyond `tournament.manage` scope (TOURN-011, TOURN-018) — team registration captures an immutable snapshot now; roster-change revalidation and per-tournament staff assignment UIs are DRAGON-09/10.
- Bulk admin registration actions and permission-controlled exports (TOURN-030) — later admin prompts; the queue is filterable and paginated today.
- Approved game/publisher/federation rule profiles (OD-006) — gated off; custom free-text rules are used until a profile is approved.
- Idempotency completion is written outside the registration transaction (shared `withIdempotency`); a crash in a narrow window can strand a key `in_progress` until its 24h TTL without overbooking or duplicating — a stronger in-session/reconciliation guarantee is a shared-infrastructure change for a later hardening prompt.

## Last verification
2026-07-22, all commands run from the repository root:
- `npm run typecheck` — pass
- `npm run lint` — pass, 0 problems
- `npm test` — 236 passed (200 api, 36 web); the competition engine has property/invariant tests for single-elim/round-robin (34), double elimination (14, full play-out n=2..32), Swiss (10, multi-round), manual graph (9), plus configuration validation
- `npm run test:integration` — 151 passed (adds 9 advanced-format competitions: double-elimination generation and play-through, byes, concurrent sibling progression, Swiss round generation with rematch avoidance and incomplete-round refusal, concurrent round generation, manual graph generation/propagation and invalid-graph rejection)
- `npm run build` — pass
- `npm run e2e` — 174 (unchanged; DRAGON-09a/09b add no user-facing UI, so the browser suite was not re-run for these slices)
- `node --test .claude/tests/guardrails.test.mjs` — 7 passed
- `npm run verify:persistence` — pass (DRAGON-01 run)
- `npm run docker:up` — web, api, mongo all healthy; migrations applied and 28 roles seeded (DRAGON-03 run)
- Package guardrails: run `03-CHECK-PACKAGE.cmd`.

DRAGON-03's proxy-trust security finding was reviewed, fixed, and re-checked (PASS); those rows are marked Reviewed. DRAGON-04 (security-sensitive RBAC) had one focused `test-reviewer` security pass: verdict PASS, no Critical/High. One Medium/plausible finding — a config-key case variant could dodge high-risk dual-control classification — was fixed by canonicalising keys, with unit and integration regression tests. DRAGON-05 (content sanitisation and draft isolation) had one focused `test-reviewer` security pass: verdict PASS, no Critical/High; sanitisation on every write path, no draft/scheduled leakage, no NoSQL injection, and safe SEO/v-html rendering all confirmed. One Medium (defense-in-depth) — the dev-only `/dev/grant-role` is safe in production but fail-open if `NODE_ENV` is unset — was hardened with a loud non-production startup warning and an ENV note. DRAGON-05 traceability rows are recorded but left Pending for review by the same reviewer independence rule used earlier. DRAGON-06 (persistent teams) had one focused `test-reviewer` pass over its ownership, invitation, and membership authorization and concurrency paths: verdict APPROVE, no Critical/High; resource-scoped owner-only enforcement, correct 404-vs-403 boundaries, the partial-unique-index race guarantees, atomic ownership transfer, in-transaction audit writes, insert-only snapshots, and privacy-aware public views were all confirmed. Two low-risk notes were applied (stable slug on rename; 404-before-403 in `listTeamInvitations`); the TEAM traceability rows are marked Reviewed. DRAGON-07 (tournament authoring) had one focused `test-reviewer` pass over money handling, publication gating, authorization, and lifecycle: verdict APPROVE, no Critical/High; exact-integer fees/prizes, published-only public reads, no public exposure of the internal question set, atomic revision+audit writes, draft-only editing, and correct state-machine and optimistic-concurrency guards were all confirmed. Two Medium notes were fixed (money domain ceiling → clean 422 instead of overflow 500; publication aggregates missing-value and date-order problems together). The TOURN authoring-scope traceability rows are marked Reviewed. DRAGON-08 (registration) had one focused `test-reviewer` pass over concurrency, authorization, IDOR, waitlist promotion, duplicate prevention, and capacity enforcement: verdict APPROVE, no Critical/High; atomic seat-counter capacity claim with no overbooking, resource-scoped admin authorization, correct self-cancel IDOR guard, deterministic waitlist ordering/promotion, the active-flag partial-unique duplicate guard, and idempotent replay were all confirmed. One Low DRY note was applied; one Medium note (idempotency completion outside the registration transaction) is a shared-infrastructure property recorded as a known limitation. The registration traceability rows are marked Reviewed. Rows from DRAGON-00 through DRAGON-02 remain Pending for review.
