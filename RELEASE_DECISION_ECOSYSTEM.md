# Dragon Ecosystem — Final Release Decision

Recorded by DRAGON-27C on 2026-07-29. This is the whole-ecosystem decision. It does not
replace or rewrite the per-phase decisions in `RELEASE_DECISION.md`,
`RELEASE_DECISION_PHASE2.md`, `RELEASE_DECISION_PHASE3.md`, `RELEASE_DECISION_PHASE4.md`,
or `RELEASE_DECISION_PHASE5.md`; it reads them and states their combined effect.

Assessed commit: `d7bf958` ("fix: harden financial recovery and reconciliation"), with one
pre-existing unrelated working-tree change to `docker-compose.yml` (the
`${WEB_PORT:-8080}` host-port escape hatch, uncommitted since `3ecd32d`).

---

## 1. Decision summary

**NO-GO.**

Four of the five phase decisions are NO-GO and every one of their blockers is still open.
The fifth — Phase 1 — is GO WITH CONDITIONS with production deployment explicitly **not**
authorized and human sign-off outstanding. Nothing in DRAGON-27 resolved any of them,
because none of them is resolvable by engineering.

The ecosystem contains a large amount of working, tested software. That is not the same
thing as a releasable product, and this verdict follows the enabled scope rather than the
implemented scope.

## 2. Assessed release scope

The whole ecosystem as built through Phase 5, in Persian and English, light and dark, at
320px through desktop: identity and accounts, public content and games, tournaments and
competitions, teams and player profiles, wallet and Dragon Coin, payments and holds,
notifications, moderation and operations, streams and chat, education, community, store,
rewards and transfers, prizes and payouts, and the administration surfaces for each.

## 3. Implemented and enabled capabilities

Enabled means the gate is open, no release-blocking decision applies, and it works end to
end against the local stack:

- Identity, OTP authentication, sessions, profiles, and privacy defaults.
- Public content, games, tournaments, teams, and player directories.
- Tournament authoring, registration, competition, bracket, and standings.
- Dragon Coin purchase through the deterministic mock provider; wallet, holds, ledger.
- Free course enrolment, lesson access, and progress.
- Stream discovery and watching; moderated live chat.
- Community follow, post, comment, react, report, and moderation.
- Digital store purchase, cart, checkout, orders, receipts.
- Reward rules and grants; direct user-to-user Dragon Coin transfer.
- Prize allocation and manual cash settlement with dual control.
- Administration and operations consoles, including the reconciliation reports.

**Every item above is qualified by the same caveat**: verified on a local stack against
deterministic mock adapters. None of it is production-validated.

## 4. Implemented but gated capabilities

| Capability | Gate | Default |
|---|---|---|
| Paid tournament entry | `PAID_TOURNAMENTS_ENABLED` (OD-007) | off |
| Paid course enrolment | `PAID_COURSES_ENABLED` (OD-015) | off |
| Stream archive and takedown | `STREAM_RIGHTS_POLICY_APPROVED` (OD-014) | off |
| Physical product purchase and fulfilment | `PHYSICAL_FULFILLMENT_ENABLED` (OD-019) | off |
| Notification SMS / email channels | `NOTIFICATIONS_SMS_ENABLED`, `NOTIFICATIONS_EMAIL_ENABLED` | off |
| External analytics forwarding | `ANALYTICS_EXTERNAL_ENABLED` (OD-026) | off |

All verified fail-closed in `apps/api/src/config.ts` and shipped `false` in `.env.example`.

## 5. Intentionally absent capabilities

Not built at all, because an open decision forbids activation — absence is the control, not
a disabled switch:

- Community blocking and muting (OD-017) — no route, collection, or index.
- Moderation appeals (OD-024) — no route, record, or case transition.
- Web/mobile push (OD-027) — no channel in the template map, no token store, no adapter.
- Digital entitlement revocation (OD-020) — no route, no `revoked` state.
- Peer marketplace commerce (OD-030) — absent; plain coin transfer is separately approved.
- Cash redemption, sell-back, exchange rate, order-book trading (DEC-023, DEC-024) —
  absent permanently, including no ledger transaction type that could balance one.
- Platform-managed returns and refunds (DEC-034); general internal Toman wallet (DEC-050).
- Direct messages and private group chat (SOCIAL-012).
- Arvan-specific streaming behaviour (OD-013) — `STREAMING_PROVIDER=arvan` fails startup.
- Approved course exercise types (OD-016) — quiz and exercise lessons refused by name.

## 6. Verification environment

Local Windows workstation, Node 24, MongoDB 8 single-node replica set via Docker Compose,
deterministic in-repository mock payment and SMS adapters. No external provider of any
kind was contacted during any verification recorded here.

## 7. Test and build evidence

Run this session at `d7bf958`:

| Check | Result |
|---|---|
| `npm run typecheck` | **pass**, exit 0 |
| `npm run lint` | **0 errors**, 63 pre-existing formatting warnings, exit 0 |
| `npm test` | **451 passed, 0 failed** (api 405, web 46), exit 0 |
| `npm run test:integration` | **491 tests**; see the intermittent below |
| `npm run build` | **pass**, exit 0 |
| `npm run test:budget` | **pass**, entry bundle 376.27 kB against a 380 kB budget |
| `npm run closure:check` | **14/14** |
| `npm run decision:check` | **12/12** |

### Intermittent integration failure — named, not dismissed

`economy.itest.ts` → *"two concurrent requests under one key move the value exactly once"*
failed once in four full-suite runs (exit 1, 490/491) and passed on the other three, and
passes consistently when its file is run alone. It is a **money-path concurrency test**
guarding the invariant that one idempotency key moves value exactly once.

An earlier observation of the same test during DRAGON-27B showed a `201 / 422` status pair,
which indicates one racer was *refused* — value moving once, with an unexpected refusal
code — rather than value moving twice. That is suggestive, not conclusive: **the failing
assertion message for the current code was not captured**, because the Docker engine became
unavailable before the diagnostic loop completed.

Classification: **unresolved — insufficient evidence to call it either a product defect or a
test-strictness artefact.** It is listed as a release blocker for the economy scope below.
It is not claimed fixed.

### Evidence not obtainable this session

The Docker engine began returning `500 Internal Server Error` on its named pipe partway
through this slice, which removed the disposable test database and the Compose stack. As a
direct result:

| Required check | Status |
|---|---|
| `npm run e2e` (complete browser suite) | **Not run this session.** Last full run: 464 passed, 1 skipped, 0 failed, exit 0 — at `e485751`, which is **two commits before** the DRAGON-27A and 27B changes |
| `npm run verify:persistence` | **Not run this session.** Last run PASS at `d7bf958` (during DRAGON-27B) |
| Docker service health | **Not run this session.** Last run: web, api, mongo all healthy at `d7bf958` |
| Fresh/existing database migration verification | **Not re-run this session.** Migration `030-recovery-indexes` was verified against both a fresh disposable database and the persisted Compose database during DRAGON-27B at this same commit |

The persistence, Docker-health, and migration evidence is at the assessed commit and is
cited as such. **The browser evidence is not**, and that is a genuine gap: no full browser
run has been executed against the DRAGON-27A locale change or the DRAGON-27B API changes.
It is recorded as an evidence gap below rather than substituted with the older run.

## 8. Security and authorization evidence

From the DRAGON-27A and 27B audits at this commit:

- **Zero admin routes lack a permission guard**, verified by resolving each module's shared
  gate helper against every registered route rather than pattern-matching.
- The only unguarded mutating routes are the two provider callbacks (HMAC-authenticated)
  and the two OTP endpoints (pre-authentication by definition).
- `/dev/grant-role` is fail-closed: registered only when explicitly flagged **and** the
  environment is not production, with a loud startup warning whenever it is on.
- Event payloads carry no secrets: `account.registered` publishes a **masked** mobile;
  `payment.purchase_created`'s `code` is a package code, not an OTP.
- Feature gates cannot be bypassed by direct API call — each is checked server-side before
  any state change, and absent capabilities have no route to reach.
- Removed community and chat content stays hidden publicly while its body is retained for
  the moderation case.
- One independent read-only security review per money-handling slice; the two Critical and
  one High findings raised across DRAGON-25 and 27B are fixed and regression-tested.

No external penetration test was performed and none is claimed.

## 9. Financial and data-integrity evidence

| Property | Evidence |
|---|---|
| Balanced ledger transactions | `ledger.itest.ts`; every journal sums to zero |
| Exact-integer money | `money.test.ts`, `store.test.ts`; the classic float error asserted impossible |
| No negative available balance | ledger overdraft guard; `store.itest.ts`, `economy.itest.ts` |
| Hold and capture idempotency | `holds.itest.ts`, `store.itest.ts` |
| Transfer concurrency | `economy.itest.ts` — **see the intermittent in §7** |
| Rolling-window limits | `economy.itest.ts`; atomic claim, concurrency-safe opening |
| Stock concurrency | `store.itest.ts`; two real racing requests, one winner, stock floors at zero |
| Immutable order snapshots | `store.itest.ts`; archiving the product leaves the order unchanged |
| Reward uniqueness | `economy.itest.ts`; once per rule per account under replay |
| Payout dual control, retry, reversal | `prizes.itest.ts`; actor-level separation, same-record retry, evidence preserved |
| Entitlement granted exactly once | `store.itest.ts`; granted only after capture |
| Reconciliation in both directions | store, economy, and finance reports each check record→evidence *and* evidence→record |
| Migration and index health | `030-recovery-indexes`; recovery scans index-served, asserted by query plan |

### Recovery is detection-only — stated precisely

The shared stuck-reservation detector reports hold-backed records that can no longer
complete. It is **read-only and repairs nothing**. Using the required distinction:

- **Detected inconsistency** — yes, for four shapes across store orders and course enrolments.
- **Automatic recovery** — none. Deliberately.
- **Operator-guided recovery** — not implemented; operators can see the state, not resolve it in-product.
- **Policy-blocked recovery** — yes. A captured-but-unfinished order has no approved remedy, because DEC-034 approves no return workflow.

It must not be described as a recovery mechanism. It is a detector.

## 10. Localization and accessibility evidence

Both locales key-parallel, every Persian value verified to contain Persian text, and — added
in DRAGON-27A — **every literal `t('key')` used anywhere in the app must resolve in every
locale**, a guard proven non-vacuous by deleting a key and confirming the failure names it.
Browser suites assert one `h1`, `label[for]` association, correct `dir` per locale, table
captions, and no raw-key pattern; user-generated bodies carry `dir="auto"`. No manual
accessibility certification has been performed, and automation does not replace one.

## 11. Persistence and migration evidence

31 ordered, idempotent migrations through `030-recovery-indexes`. Verified at this commit
during DRAGON-27B against both a fresh disposable database and the persisted Compose
database; committed MongoDB data survived a Compose stop/start on the named volume. Not
re-run this session — see §7.

## 12. Operational readiness

nginx is the single published entry point; API and MongoDB are not publicly exposed. Health
checks, correlation IDs on every request, bounded operational error storage, alerting, job
visibility, three reconciliation reports, and the new permission-protected
`GET /admin/ops/stuck-reservations`. Mock and real provider paths are separated, every
feature gate defaults closed, environment validation fails startup on a missing production
secret, and an unsupported streaming provider selection refuses to start. Docker health was
not re-verified this session (§7).

## 13. Performance and capacity evidence

| Claim | Classification |
|---|---|
| Bundle budget | **Measured** — 376.27 kB against 380 kB |
| Route splitting | **Measured** — admin/account chunks split out |
| Cursor pagination | **Structurally verified** |
| Indexed high-growth queries | **Structurally verified**, plus one measured query plan for the recovery scan |
| Bounded reconciliation scans | **Structurally verified** |
| Bounded feed and chat pages | **Structurally verified** |
| Rate limits | **Structurally verified** |
| Concurrent writes | **Measured at test scale** — real racing requests for stock and transfers |
| Load testing | **Not measured** |
| External provider capacity | **Blocked by external integration** |

No structural claim is presented as measured. **Bundle headroom is 3.73 kB** — listed as a
release risk. The budget was not raised in this slice.

## 14. External-provider readiness

**None.** Payment and SMS are deterministic in-repository mocks. No streaming provider is
contracted (OD-013). No shipping carrier is selected (OD-019, INT-008). No push provider is
selected (OD-027). No payout provider is required or built (DEC-045). No claim is made about
how any external provider would behave, because none has been contacted.

## 15. Open-decision matrix

| ID | Capability | Default | Implementation state | Release effect | Condition to unblock | Engineering can resolve? |
|---|---|---|---|---|---|---|
| OD-013 | Arvan streaming capabilities | stub provider | Adapter boundary built; `arvan` fails startup | Blocks Phase 2 | Contracted capabilities confirmed and sandbox-validated | No |
| OD-014 | Stream rights, archive, takedown | off | Gated; archive and takedown refused | Blocks Phase 2 | Approved retention and takedown policy | No |
| OD-015 | Paid-course commercial terms | off | Mechanism built and tested | Blocks Phase 3 | Ownership, refund, revocation, coach terms approved | No |
| OD-016 | Course exercise types | n/a | Quiz/exercise refused by name | Blocks Phase 3 | An approved exercise-type list | No |
| OD-017 | Blocking, muting, privacy defaults | off | **Absent** | Blocks Phase 4 | Approved trust-and-safety policy | No |
| OD-019 | Physical delivery policy | off | Catalog built; purchase refused | Blocks Phase 5 | Carriers, regions, rates, service levels approved | No |
| OD-020 | Digital entitlement revocation | off | **Absent** | Blocks Phase 5 | Approved entitlement and revocation rules | No |
| OD-024 | Moderation appeals | off | **Absent** | Blocks Phase 4 | Eligibility, window, reviewer separation, finality | No |
| OD-027 | Push provider | off | **Absent** | Blocks Phase 4 | Provider and platforms selected | No |
| OD-030 | Peer marketplace commerce | off | **Absent** | Blocks Phase 5 | Meaning of a user-to-user purchase settled | No |

Every gate above was verified fail-closed, and every capability marked **Absent** was
verified to have no route, state, collection, job, or UI action.

## 16. Release blockers

1. **OD-013, OD-014** — Phase 2 NO-GO stands.
2. **OD-015, OD-016** — Phase 3 NO-GO stands.
3. **OD-017, OD-024, OD-027** — Phase 4 NO-GO stands.
4. **OD-019, OD-020, OD-030** — Phase 5 NO-GO stands.
5. **Phase 1 production deployment is not authorized** and 362 `Evidence pending` rows remain undispositioned under condition C1 of `RELEASE_DECISION.md`.
6. **Authorized human sign-off is outstanding for every phase.** A model-generated recommendation is not human acceptance.
7. **No live payment provider** — the entire money path runs on a deterministic mock.
8. **Unresolved intermittent failure in a money-path concurrency test** (§7). Blocking for the economy scope until diagnosed.
9. **No full browser run against the current commit** (§7). An evidence gap, not a known failure.

## 17. Non-blocking risks

- Stuck-reservation handling is **detection-only**; the remedy is policy-blocked.
- Scale is unmeasured — every performance claim beyond the bundle is structural.
- Bundle headroom is 3.73 kB; the next entry-chunk addition will need a split.
- The browser suite has intermittently exited non-zero while reporting all tests passed (seen in DRAGON-24, 25, 26). Undiagnosed, and not reproducible this session because the suite could not be run.
- The `docker-compose.yml` working-tree change remains uncommitted.

## 18. Deferred work

Community analytics (ANALYTICS-005); catalog, conversion, inventory, and coin analytics
(ANALYTICS-006 beyond reconciliation); team membership applications (TEAM-011 remainder);
product categories; cart expiry; `/account/payouts` (PAGE-043); `/coaches/{slug}`
(PAGE-033); course revenue reporting (ANALYTICS-004); an operator-guided recovery workflow
once policy allows one.

## 19. Reviewer findings

**No independent reviewer was run for this slice.** The slice permits at most one, and the
judgment was that it would add little: this slice changes no product code, and its verdict
is determined by five existing phase decisions and ten unresolved external decisions, each
of which was read directly rather than inferred. Every substantive claim in this document
is drawn from a review that already happened — DRAGON-27A, 27B, and the per-phase security
reviews, whose findings are summarised in §8 and §9. Recorded as a deliberate omission
rather than an oversight.

## 20. Final verdict

**NO-GO** for the Dragon Ecosystem as a whole.

Ten external decisions remain open, four phase decisions are NO-GO, Phase 1 forbids
production deployment, no live payment provider exists, and authorized human sign-off is
outstanding everywhere. The verdict follows the enabled scope, not the volume of working
code.

### A reduced scope would not change it

A narrower "free, local, mock-provider" scope — public content, games, free tournaments,
free courses, community, wallet display — is the closest thing to releasable here, and it
is what `RELEASE_DECISION.md` already covers with GO WITH CONDITIONS for local and test
environments only. Even that scope carries production-not-authorized and pending human
sign-off. **This reduced scope is described for information and is not substituted for the
ecosystem decision.**

## 21. Conditions required to change the verdict

1. All ten open decisions resolved and recorded, and their gated capabilities implemented and verified under the approved policy.
2. A live payment provider integrated and validated, replacing the deterministic mock.
3. The 362 `Evidence pending` traceability rows dispositioned (condition C1 of `RELEASE_DECISION.md`).
4. The intermittent money-path concurrency failure diagnosed and either fixed or proven to be test strictness.
5. A full browser suite run, green, against the released commit — including a diagnosis of the intermittent non-zero exit.
6. Manual accessibility certification across the release surface.
7. Production capacity evidence under realistic load, replacing structural claims.
8. Deploy, backup, restore, and observability rehearsal in a production-like environment.
9. An operator-guided recovery path for stuck reservations, once policy defines the remedy.
10. Authorized human sign-off for every phase and for the ecosystem.

## 22. Authorized human approval

**Production deployment authorized: NO.**

**Awaiting authorized human sign-off.** This document is a model-generated recommendation.
It is not acceptance, and it does not authorize a release.
