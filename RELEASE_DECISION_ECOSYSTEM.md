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

## 15b. DRAGON-28 remediation — what closed and what did not

Assessed after remediation at working-tree state on top of `7ae35fe`.

### Closed engineering gaps

| Gap | Outcome |
|---|---|
| Economy concurrency failure | **Fixed.** Root cause was a product defect, not a flaky test: `claimTransferWindow` treated "the window did not exist yet" as "the budget is exhausted", so when two transfers arrived together on a sender's first transfer of a period, one was refused with a misleading limit error (`201 / 422`). The claim now retries once against the window a racer just opened, and only reports a limit after re-reading it. Reproduced at ~1-in-3 before; **0 failures in 10 bounded runs** after, and the full integration suite is 492/492, exit 0 |
| Docker engine and health | **Restored.** Engine 28.1.1; web, api, mongo all healthy; only 8080 published; API and MongoDB not directly exposed |
| Persistence at current commit | **PASS.** Committed data survived a Compose stop/start on the named volume |
| Entry-bundle headroom | **376.27 kB → 341.13 kB** against an unchanged 380 kB budget; headroom 3.73 kB → **38.87 kB**. The three public *detail* views (tournament, content, game) moved to lazy route chunks — they are reached by a click or a direct link, never as a first paint. `TournamentDetailView` alone is 25.52 kB |
| Full browser run at current commit | **Obtained**, and it corrected a previous misclassification — see below |

### Correction to a previously reported finding

Earlier release documents recorded that the browser suite "intermittently exited non-zero
while reporting every test passed". **That was wrong, and the error was mine**: the runs
that exited non-zero had a genuinely failing test, and the console filters used to summarise
them truncated the failure line out of view.

The real behaviour is an ordinary flaky test:
`moderation.spec.ts` → *"report a tournament … and a moderator sees it (fa)"*, desktop
project. Observed once as `1 failed / 463 passed` (npm exit 1) and clean on the
surrounding runs (`464 passed`, exit 0). Playwright's own artifact directory named it.

There is no phantom exit-code defect, no `webServer` shutdown bug, and no npm exit-code
propagation problem. The repository scripts report failure correctly; the earlier reports
did not. **The flake itself is not diagnosed** and is carried as an engineering risk.

### Moderation browser flake — root cause established

`moderation.spec.ts` → *"report a tournament, collapse into one case, and a moderator sees
it (fa)"*, desktop. **Confirmed test-isolation defect, not a product defect and not
external.**

The moderation queue returns a default page of 20 cases sorted newest-first
(`moderation/service.ts` `listCases` → `clampLimit`), and the admin view loads only the
first page. The test asserts `toHaveCount(1)` on a row matched by its own tournament's id
prefix. During a full-suite run, other specs create moderation cases in parallel between
this test filing its reports and opening the queue, pushing its row off page one — the
assertion then sees zero rows.

Evidence: **6/6 clean in isolation**, fails roughly 1-in-3 only inside the full suite. Id
prefix collision was excluded — ids are UUIDv4, so an 8-character prefix is random, not a
timestamp.

**Fixed, test-only.** The spec now pages forward through the queue's own `load-more`
control — bounded at ten pages — until the row is reachable, then asserts exactly as
before. No assertion was weakened and no product behaviour was changed: `toHaveCount(1)`,
the state and severity checks and the identifier-leak checks are all unaltered. The
subject-scoped queue read remains the better *product* remedy and is still not
implemented, because adding it would be new product scope; it is recorded as a design
improvement, not a blocker.

Verification: the browser suite was run **17 times** after the fix. **14 runs were clean
(464 passed, exit 0)**; three runs failed once each, and *none of them was the moderation
test* — it did not fail once in 17 runs.

The three failures were three different specs, each failing exactly once, all on the
**small-mobile (320px)** project, and all of the same shape — a 30-second wait for an
element that never appeared:

| Run | Spec | Symptom |
|---|---|---|
| 4 | not captured — the run's output was filtered before the failure block was read | unknown |
| 12 | `community.spec.ts:92` JOURNEY-006 (en) | element wait |
| 17 | `registration.spec.ts:90` | `locator.click` timeout on `open-register-form` |

**The cause of these three is not established.** They are not the moderation defect, whose
root cause was identified and is fixed. One occurrence each is not enough to diagnose, and
the honest classification is a **remaining engineering risk: the browser suite is not
reliably green under full parallelism on this machine**, concentrated in the small-mobile
project. This is recorded rather than smoothed over: the suite must not be described as
passing cleanly.

### Accessibility preparation

`ACCESSIBILITY_CERTIFICATION.md` added: 20 criteria across four audiences, both locales,
320px and desktop, each marked with its automated coverage and what only a person can
confirm. Six criteria have no automated coverage at all — focus order, focus-indicator
contrast, 200% zoom, measured contrast, reduced motion, and the screen-reader pass — and
those are the substance of a certification.

**Engineering preparation complete. Authorized human certification pending.** No tester,
date, result, or signature was recorded, and engineering has no authority to record one.

### Traceability reconciliation

All **344** `Evidence pending` rows were dispositioned row by row against the source
requirement, the registered route or collection, the module's tests, and the applicable
gate or open decision. Nothing was replaced mechanically: the applier refused to write
until every cited file path, test filename and index name resolved to something that
actually exists in the repository.

| Status | Rows |
|---|---|
| Implemented | 404 |
| Verified | 175 |
| Partial | 125 |
| Evidence pending | 29 |
| In progress | 25 |
| Deferred | 14 |
| Blocked | 13 |
| Blocked by open decision | 10 |
| Gated | 9 |
| Deferred by phase | 4 |
| Not applicable | 2 |

The 344 resolved as: **200 Implemented, 96 Partial, 29 still Evidence pending, 12 Blocked,
4 Gated, 2 Deferred, 1 Not applicable** — 344 exactly. (An earlier revision of this
section printed 154/121, which did not sum to 344; the reviewer caught it and the
figures above are recounted from the document itself.)

**Partial** was used wherever a compound requirement had one clause satisfied and another
absent, with the unsatisfied clause named — SEC-013 has signature validation, size limits
and private staging but **no malware scanning**; SEC-014 has scoped audited roles but **no
periodic access review**; PAY-005 has six payment states but no reversed, refunded or
disputed state. Catalogued API paths the implementation deviates from (`/auth/sessions` →
`/account/sessions`, `/me/profile` → `/account/profile`, and others) are recorded as
deviations on an otherwise Implemented row rather than quietly accepted.

**DRAGON-29C reviewed all 27 pending rows individually and dispositioned 19 of them.** The
count is **8**. It was 29 before DRAGON-29B (SEC-016 and SEC-017 moved to `Partial` once the
dependency scan existed), then 27, and now 8.

What moved, and why:

| Moved to | Rows | Basis |
|---|---|---|
| **Implemented** (8) | DOC-009, DOC-011, DOC-012, DOC-013, DOC-014, DOC-015, EVENT-012, ANALYTICS-008 | Six documents written against the code as it is: `DOMAIN_EVENTS.md`, `COMPETITION_GUIDE.md`, `FINANCIAL_GUIDE.md`, `LOCALIZATION_GUIDE.md`, `AUTHORING_GUIDE.md`, `METRICS.md`. Each states its own limitations rather than implying completeness |
| **Partial** (2) | PERF-009, ADMIN-011 | PERF-009: cache headers implemented and test-guarded; **no CDN**. ADMIN-011: per-user role reads and revocation exist; **no cross-user report and no last-use recorded** |
| **Blocked by open decision** (9) | API-008, API-009, FORM-004 (**OD-003**); AUTH-011, DATA-088, PAGE-024 (**DEC-043**); ANALYTICS-002, ANALYTICS-009, PAGE-068 (**OD-026**) | These were mis-filed as engineering-owned. They are not: email identity needs a contracted provider, deletion/consent/legal needs the data-class and retention policy, and analytics reporting needs the tooling decision that determines where a report is even computed |

The correction matters more than the count. The previous revision asserted that **"no external
input is needed to build any of them"**. That was wrong for nine rows. Building an email
identity method with no provider to verify against, a deletion path with no policy saying what
must be retained, or a report whose computation site the tooling decision may move, would each
have produced a capability the platform could not honestly complete.

### DRAGON-29D: 8 → 6, and a tracking gap worth naming

Match scheduling and rescheduling are implemented (API-043, TOURN-020), which also corrected
**TOURN-019** — that row was `Implemented` citing the display-side formatters while matches had
**no time field at all**, so there was nothing stored to display. It now cites the real
`scheduledAt` field and a test proving an offset-bearing input is normalized to UTC.

The remediation surfaced a gap in the decision-tracking model itself. **OPS-008, PAGE-025 and
PAGE-051 are each blocked by a policy input that nobody has registered as an open decision** —
the operational availability rule, what public service state may be published and by whom, and
the permitted staff-action set over a team owner. The closure check correctly refuses to let
them sit as `Blocked by open decision`, because that status must cite a decision id and the
OD register in `Requirements.md` runs OD-003…OD-030 with no entry for any of them. They
therefore remain `Evidence pending` with the gap stated on the row.

The consequence for release reading: the open-decision list understates what is actually
undecided. Three requirements are waiting on policy that no decision record is tracking, so
they will not appear in any count of open decisions.

### The rows that remain pending

All eight are engineering-owned and none is blocked by an external decision, so they are
recorded as pending work rather than reclassified into a status that would flatter the count.
Each row now names its missing evidence, why what exists is insufficient, its owner, and a
concrete next action.

| Rows | Why still pending |
|---|---|
| API-043, TOURN-020 | Match rescheduling: no reschedule operation, so no old/new time, actor, reason, or notification. One feature, two rows; needs a versioned write plus a new event-to-template mapping |
| PAGE-017, PAGE-018 | Per-account registration and match views: **no per-account read exists** in the API, and the registration record stores no state history, so the "status history" clause cannot be met from it. PAGE-017 also needs a new index and migration |
| PAGE-023, PAGE-025, PAGE-051 | Help, status and staff team administration: each needs one non-engineering input first — approved help copy, a status source that is not the probe on the host being reported about, and the permitted staff-action set over a team owner |
| OPS-008 | Maintenance mode: needs a server-controlled flag, a localized public response, and an operational rule for which staff paths stay reachable |

Two of these were deliberately **not** built in this slice despite being buildable. PAGE-025
over `/health/ready` alone would state nothing useful during the outage it exists for, and
PAGE-023 would ship help text nobody approved. Shipping either to reduce a count would be the
kind of hollow surface the repository has avoided elsewhere (MOD-008 appeals).

*(This table records the position at DRAGON-29C. Five of the eight have since been
dispositioned — API-043 and TOURN-020 by DRAGON-29D, PAGE-017 and PAGE-018 by DRAGON-29E, and
PAGE-023 by DRAGON-29F, which built the support entry point and left the FAQ, the tournament
help and the search over them explicitly unbuilt. **Three remain: OPS-008, PAGE-025 and
PAGE-051** — see "Remaining engineering blockers" below for the current reading. The claim
above that all eight were engineering-owned no longer holds for those three, and did not hold
when it was written: each is waiting on a policy input, as the paragraph before this table
already says.)*
*(The CI-pipeline category that stood here — SEC-016 dependency and image scanning, SEC-017
vulnerability gate — left this table in DRAGON-29B. Both are now `Partial`: the dependency
scan and the high/critical gate exist and run; container-image scanning and a formal
risk-acceptance mechanism do not.)*

Each of those rows records the exact missing evidence, why the existing tests cannot prove
it, and who must supply it.

### Bounded local performance measurements

`apps/api/src/perf/perf.itest.ts` runs under `npm run test:integration` against a
disposable database and reports both a latency distribution and the correctness invariant
that must hold while the contention is happening.

**The file is committed** (DRAGON-29B.2). Until then it was untracked, so every claim on this
page rested on a file absent from Git and from CI — the integration count read 501 locally
and 493 remotely, and the eight-test difference was exactly this file. It now runs in the
remote `integration` job, so the correctness invariants below are verified on every push and
pull request rather than only on one developer's machine.

**What CI verifies, and what it does not.** The scenarios assert **correctness only**; no
latency threshold is asserted anywhere, so a slower runner cannot fail the job and CI
publishes no timing claim. The latency figures in the table below remain a **local**
measurement on the machine named beneath it, and re-running reproduces the same invariants
with different numbers.

**Environment:** Node v24.13.1, win32 x64, MongoDB replica set on `127.0.0.1:27018`,
throwaway database dropped after the run, requests via `app.inject` — in process, with no
network, TLS, proxy or connection pool in the path.

| Scenario | Concurrency | Ops | p50 | p95 | max | Correctness result |
|---|---|---|---|---|---|---|
| A1 one key, cold window | 8 | 8 | 58.8 ms | 74.9 ms | 74.9 ms | 1 accepted, 7 × 409; **10 coin moved once**, exactly 1 ledger transaction |
| A2 one key, open window | 8 | 8 | 45.2 ms | 65.0 ms | 65.0 ms | 1 accepted, 7 × 409; **value moved once**, no duplicate posting |
| A3 distinct keys, cold window | 8 | 8 | 119.9 ms | 155.5 ms | 155.5 ms | **8/8 accepted**, 80 moved — the DRAGON-28 defect would surface here |
| A4 distinct keys, open window | 8 | 8 | 102.1 ms | 143.3 ms | 143.3 ms | 8/8 accepted, 80 moved |
| B rolling-window claims | 24 | 24 | 26.2 ms | 40.2 ms | 40.9 ms | budget 20 → **admitted 20, overshoot 0**, 4 refused, 4 compensations applied, stored counter = admitted |
| C store last-unit contention | 8 | 8 | 58.5 ms | 99.0 ms | 99.0 ms | **exactly 1 winner**, 7 × 409, final stock 0, exactly 1 order line |
| D stale-reservation scan | 1 | 1 | — | — | 4.6 ms | 301 rows (60 stale / 120 recent / 120 terminal); 50 findings at a configured limit of 50; **IXSCAN on `order_state_created`**, 50 keys and 50 docs examined |
| E store reconciliation | 1 | 10 | 10.7 ms | 13.3 ms | 13.3 ms | 10/10 × 200 over 301 orders (121 paid) |

**Errors: zero.** Every scenario asserts its invariant, so a regression fails the run
rather than merely reporting a slower number.

**Limitations — these are not production capacity evidence.** `app.inject` bypasses the
network stack, so the latencies are a floor. Eight to twenty-four concurrent operations is
contention, not load. The dataset is hundreds of rows, not the DEC-046 scale baseline. No
agreed normal-load profile exists (OD-023), so nothing here can be compared against
PERF-001, PERF-002 or PERF-003. Scenario E's seeded paid orders carry no line items, so it
measures the query path rather than difference detection.

**Classification: Measured locally; invariants structurally verified in CI.** The timing
figures are *measured locally* and nothing more. The invariants each scenario asserts are
*structurally verified* on every CI run now that the file is committed. Production-scale load
remains **not measured** and PERF-014/OPS-014 remain **blocked by external decisions**
(OD-023 for the load profile, DEC-046 for the scale baseline). Committing the file changed
where these tests run — it changed no claim about what they prove.

PERF-004 moves to *Implemented* on this evidence —
the scan examines exactly its configured bound and is index-backed. PERF-001, PERF-002,
PERF-003, PERF-006, PERF-014 and OPS-014 remain **Blocked**, and the local numbers are
recorded on those rows for orientation only, explicitly not as evidence for the targets.

### Not attempted in this remediation

- **The 29 remaining `Evidence pending` rows were not implemented.** They are recorded with their exact missing evidence and owner; building them is new product scope.
- **The subject-scoped moderation queue read** — the product-level remedy — was not added.
- **No load testing.** PERF-014 and OPS-014 stay blocked.

## 15c. Corrected blocker classification

The earlier statement that *"every remaining blocker is external"* was **wrong**. Three
gaps remain that engineering owns and can close without any external input:

### Remaining engineering blockers

| Item | Why it is engineering-owned |
|---|---|
| 3 `Evidence pending` rows | Down from 8. DRAGON-29D implemented match scheduling and rescheduling (API-043, TOURN-020); DRAGON-29E implemented the participant match view (PAGE-018 → Implemented) and the account registration view with an append-only transition history (PAGE-017 → **Partial**, three clauses named: the staff reason is withheld by the established privacy boundary, payment detail stays out of participant scope, and the authorized withdraw action is offered on the tournament page rather than this one); DRAGON-29F built the `/help` support surface (PAGE-023 → **Partial**, three clauses named: the FAQ, the tournament help and the search over them all await approved copy). **The three that remain are each blocked by a policy or content input that has no registered open-decision id**: maintenance mode (OPS-008), the public status page (PAGE-025) and staff team administration (PAGE-051). Those three cannot honestly be rowed `Blocked by open decision`, because that status requires citing a decision and OD ids are defined in `Requirements.md` (OD-003…OD-030); inventing one would fabricate an external decision. |
| 131 `Partial` rows | Each names an unsatisfied clause — no malware scanning (SEC-013), no periodic access review (SEC-014), no refund states (PAY-005), no per-match referee scope (TOURN-021, ROLE-010), no URL-persisted admin query state (ADMIN-006), no CDN (PERF-009), no cross-user access-review report or last-use record (ADMIN-011). |
| 19 `Blocked by open decision` rows | Up from 10. DRAGON-29C moved nine rows here that had been mis-filed as engineering-owned: email identity needs a contracted provider (**OD-003**), deletion, consent and legal documents need the data-class and retention policy (**DEC-043**), and analytics reporting needs the tooling decision (**OD-026**). None is engineering's to close. |
| No risk-acceptance mechanism (SEC-017) | The dependency gate exists and works — its first remote run caught `find-my-way <=9.6.0` (GHSA-c96f-x56v-gq3h, CVSS 7.5), which DRAGON-29B.1 fixed by updating that transitive dependency to `9.7.0`; the audit now reports 0 vulnerabilities. What is still missing is the requirement's other half: the repository names no approver and defines no waiver record, so there is no way to *formally risk-accept* a finding that cannot be fixed. That is not an engineering decision. |
| CI activation | The pipeline has run remotely once. Branch protection has **not** been switched on, so nothing yet compels the checks to pass before a merge, and no green run exists yet — the three jobs that failed were fixed but need a second run to confirm. Both remaining steps are repository-administrator actions, documented in `CI.md`. |

Closed since the previous revision: the **moderation E2E flake** (test-only fix; the
moderation test did not fail once in 17 full-suite runs), the **344 pending traceability
rows** (dispositioned row by row), and the **absence of performance measurement** (bounded
local measurements now recorded).

### "No CI pipeline" — closed as an implementation gap by DRAGON-29B

The pipeline is [`.github/workflows/ci.yml`](.github/workflows/ci.yml), documented in
[`CI.md`](CI.md). Ten jobs on `pull_request` and `push` to `main` plus manual dispatch:
`validate`, `static`, `unit`, `integration`, `build-budget`, `migrations`, `e2e`,
`security`, `persistence` (main and manual only), and a `required` summary that fails if
any of them fails, is cancelled, or is skipped for a reason it did not declare.

Every step invokes a script the repository already owns, so a green pipeline means the same
commands a developer runs locally passed — there is no CI-only variant of any check, no
relaxed configuration, and no step that can pass while the command inside it fails.
Workflow-level permissions are `contents: read`, and the pipeline uses **no secrets at all**,
so an untrusted forked pull request has nothing to reach.

**What this does not close:**

- **There is no green remote run yet.** One run has executed (DRAGON-29B.1). Six jobs passed;
  `security`, `persistence`, and `e2e` failed, each for a real reason, and all three are
  fixed and verified locally. A second run is required before the pipeline may be described
  as green, and none is claimed here.
- **Branch protection is not active.** Nothing yet compels the checks to pass before a
  merge. `CI.md` lists the exact settings and required check names for an administrator;
  the classification is *CI implementation complete, repository administrator activation
  pending*.
- **The first run earned its keep.** It caught a high-severity advisory in the shipped
  dependency tree, a CI assertion that silently depended on an uncommitted working-tree
  change, and two product defects that three vacuous browser assertions had been hiding —
  the player page could not unfollow after a reload, and the store operator console rendered
  in full for any signed-in user. None of the four was visible to the local suite.
- **Container-image scanning is absent** (SEC-016) and **no risk-acceptance mechanism
  exists** (SEC-017).
- This is dependency and hygiene checking. It is **not** a penetration test, an authorized
  security review, a SAST run, or a licence audit, and it does not substitute for one.

### Browser-suite instability — closed by DRAGON-29A

The previous revision opened this as an engineering blocker with **no established cause**:
three specs failing once each across 17 full-suite runs, all on small-mobile, all
element-wait timeouts. It is now diagnosed and closed. The "all on small-mobile" reading
was itself an artefact — small-mobile is simply the first project in the run order, so it
absorbs the start-up contention. A deliberate full parallel reproduction produced **7
failures across all three viewport projects**, which is what made the causes separable.

**Root cause 1 — a stale toast satisfied the wait (test defect).**
`teams.spec.ts:58` failed in all three projects at once, so it was never intermittent.
After clicking *send invite* the test waited on `expect(getByTestId('toast')).toHaveCount(1)`.
The toast queue is Vue module state that survives client-side navigation and nothing
expires it, so the *"team created"* toast pushed a few lines earlier already satisfied the
count. The assertion returned instantly and the invitee loaded their page while the
invitation was still being written. Fixed by waiting on the invitation `POST` itself.

**Root cause 2 — the disposable database was never disposed of (test-data isolation).**
Every spec generated mobile numbers as `0912` + seven random digits, a 10^7 space, against
a database that had accumulated **22,597 accounts and 90 collections** across runs. At
roughly 800 sign-ins per run that reused an already existing account about twice per run —
silently, since a reused number still signs in. Fixed by generators that are unique by
construction and by dropping the database before each `npm run e2e`.

**Root cause 3 — host CPU saturation, not an application fault.**
The remaining failures were the machine, not the product. Two were `Test timeout of 30000ms
exceeded while setting up "page"` — Chromium could not open a page inside thirty seconds —
and the retained traces show the application mid-request when the assertion's budget ran
out (in one, the API had answered `202` in 288 ms and the renderer had not run the
continuation five seconds later). Playwright's default of one worker per two cores assumes
a worker costs one page; the multi-actor journeys here run two or three. A control run at
the old worker count **with every other fix already applied still failed 4 tests, all four
of them the 30-second page-setup timeout**, which is what makes the worker cap load-bearing
rather than a way to slow the suite until failures stop.

No product defect was found behind any of the seven failures, and no product code changed.

**Evidence — every run below at exit 0, no retries configured, no test disabled or skipped
beyond the one intentional pre-existing skip:**

| Run | Command | Result |
|---|---|---|
| Full suite, normal settings | `npm run e2e` | 464 passed, 1 skipped, 0 failed, exit 0 |
| Full suite, no database reset | `npx playwright test` | 464 passed, 1 skipped, 0 failed, exit 0 |
| Small-mobile only | `npx playwright test --project=small-mobile` | 155 passed, 0 failed, exit 0 |
| Focused repetition ×3, all projects | `npx playwright test teams community registration economy moderation --repeat-each=3` | 297 passed, 0 failed, exit 0 |

Recorded against working-tree state on top of commit `b752af2`; DRAGON-29A created no
commit.

### Remaining evidence gaps

Manual accessibility certification (checklist prepared, human execution required),
production observation under real load, and load testing at the DEC-046 scale baseline
(OPS-014, PERF-014) — local contention measurement exists but is not load evidence.

### Remaining external blockers

Ten open decisions, payment-provider contract and credentials, authorized production
sign-off, and authorized human accessibility certification. **These, and only these, are
outside engineering's control.**

## 16. Release blockers

1. **OD-013, OD-014** — Phase 2 NO-GO stands.
2. **OD-015, OD-016** — Phase 3 NO-GO stands.
3. **OD-017, OD-024, OD-027** — Phase 4 NO-GO stands.
4. **OD-019, OD-020, OD-030** — Phase 5 NO-GO stands.
5. **Phase 1 production deployment is not authorized** and 362 `Evidence pending` rows remain undispositioned under condition C1 of `RELEASE_DECISION.md`.
6. **Authorized human sign-off is outstanding for every phase.** A model-generated recommendation is not human acceptance.
7. **No live payment provider** — the entire money path runs on a deterministic mock.
8. ~~Unresolved intermittent money-path concurrency failure~~ — **resolved in DRAGON-28**; it was a real product defect and is fixed (§15b).
9. ~~No full browser run against the current commit~~ — **obtained in DRAGON-28** (§15b).

## 17. Non-blocking risks

- Stuck-reservation handling is **detection-only**; the remedy is policy-blocked.
- Scale is unmeasured — every performance claim beyond the bundle is structural.
- Bundle headroom is 3.73 kB; the next entry-chunk addition will need a split.
- **Corrected:** the browser suite does not exit non-zero with all tests passing. It has one flaky test — `moderation.spec.ts` *"report a tournament … and a moderator sees it (fa)"* — which fails roughly one run in three. Undiagnosed. The earlier "phantom exit code" reports were a reporting error on my part, not a defect (§15b).
- Entry-bundle headroom improved to 38.87 kB, so this is no longer a near-term risk.
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
