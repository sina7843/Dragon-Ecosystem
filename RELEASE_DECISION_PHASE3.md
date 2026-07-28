# Phase 3 Release Decision — courses, enrolment, and progress

Recorded by DRAGON-21 on 2026-07-29. Scope: Phase 3 (GOAL-007) only. Phase 1's decision is
in `RELEASE_DECISION.md` and Phase 2's in `RELEASE_DECISION_PHASE2.md`; neither is changed
by this document.

Tested commit: `c9cc9ec` (DRAGON-20, "feat: add courses enrollment and learner progress"),
on top of `9a2873a` (DRAGON-18 + DRAGON-19). The DRAGON-21 hardening and evidence in this
document sit on top of `c9cc9ec` and are **not yet committed**.

## Decision: NO-GO

Phase 3 must not be released.

As with Phase 2, the verdict is **not** driven by a defect. Every implementation
acceptance criterion in DRAGON-20 and DRAGON-21 is met and verified, the deterministic
suites are green, and no Critical or High implementation finding is outstanding. Phase 3 is
blocked by two unresolved external decisions, both classified as release-blockers by this
prompt's own gate table.

Releasing Phase 3 today would ship a learning product whose commercial terms — who owns a
course, what a refund is, and whether a coach is paid anything — nobody has decided.

## External blockers (not implementation failures)

| Blocker | Owner | What is missing | Effect if released anyway |
|---|---|---|---|
| OD-015 | Education and legal | Coach onboarding, course content ownership, paid-course refund policy, access-revocation policy, and any coach commercial terms | Paid enrolment ships disabled. A published course cannot be priced, no learner can pay for one, and a revocation records itself without any refund — because no refund rule exists to apply. |
| OD-016 | Education | Whether quizzes and exercises are required at Phase 3 launch, and which exercise types are approved | Quiz and exercise lessons are refused at authoring. EDU-003's "approved exercise types" has an empty approved set, so the lesson catalogue is text, video, and file only. |

Neither can be closed by engineering. Both require a product and legal decision.

## Implementation failures blocking release

**None.**

## Verification run for this decision

- `npm run typecheck` — pass (both workspaces)
- `npm test` — 391 tests: 390 passed, 1 failed; the failure is pre-existing and unrelated (see below)
- `npm run test:integration` — 389 passed, 0 failed
- `npm run build` — pass · `npm run test:budget` — pass
- `npm run e2e` — **353 passed, 1 skipped, 0 failed**, across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL and en LTR
- `npm run verify:persistence` — **PASS**: committed MongoDB data survived a Compose stop/start on the named volume
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12

### Phase 3 acceptance criteria, evidenced

| Criterion | Evidence |
|---|---|
| Free course journey, fa + en | `academy.spec.ts` — enrol, work the curriculum, no raw i18n keys |
| Paid course journey, fa + en | `academy-paid.spec.ts` — buy Dragon Coin through the mock provider, reserve a place, capture the price, reach the lessons, balance 100 → 40 with nothing held |
| Payment failure | `academy-paid.spec.ts` — a failed mock payment credits nothing and the course stays out of reach; a learner without enough coin is refused with no place reserved |
| Duplicate callback | `academy-paid.spec.ts` — a replayed verified callback credits exactly once, and the course still costs its full price |
| Access denial | `academy-paid.spec.ts` — a `pending_payment` enrolment does not open the lessons (BR-024); `academy.spec.ts` — a revoked enrolment loses the player; a locked lesson delivers no body |
| Progress persistence | `academy.spec.ts` — progress survives a reload; `education.itest.ts` — idempotent and monotonic, one row per enrolment/lesson |
| Completion | `academy.spec.ts` — finishing every required lesson completes the course; `education.test.ts` — deterministic under repeated evaluation |
| Responsive lesson consumption | `academy-paid.spec.ts` — the player has no horizontal overflow at the 320px floor |
| Accessibility | `academy-paid.spec.ts` — the lesson list is a real `navigation` landmark with reachable controls; the whole suite runs the shared primitive a11y matrix |
| Shared-ledger reconciliation | `education.itest.ts` — every transaction a course capture produces balances to zero, and the learner's stored balance equals the sum of their entries |
| Mongo persistence | `npm run verify:persistence` — PASS |
| Docker | `compose-topology.test.ts` asserts the topology; see the pre-existing failure below |
| Notifications | `education.itest.ts` — completion publishes `course.completed` through the shared outbox; education keeps no notification table (NOTIF-010) |
| Localization | Both locales key-parallel (`locales.test.ts`); every academy browser test asserts no raw i18n key leaks |

### OD-015 / OD-016 remain disabled, with no misleading UI

- `education.itest.ts` asserts that with the gate off **no** course anywhere carries a paid access model or a price, and **no** `course_enrollment` hold exists.
- `education.itest.ts` asserts that **no** stored lesson has a `quiz` or `exercise` type.
- The education console renders an explicit "paid courses are disabled pending approval" badge when the gate is off, and the browser test asserts the badge state matches the server's reported config rather than assuming either way.
- There is no certification, accreditation, or coach-payout endpoint, field, or user-facing string anywhere (EDU-012).
- The coach's public fields are shown as text rather than as a link, because the coach page is deferred — a control leading nowhere would be the misleading UI this criterion is about.

## Pre-existing repository failures, separated from this work

| Failure | Origin | Note |
|---|---|---|
| `compose-topology.test.ts` "nginx remains the public entry point on 8080" | Uncommitted working-tree change to `docker-compose.yml` (`"${WEB_PORT:-8080}:8080"`) | The test asserts a literal `8080:8080`. Either the test or the compose change needs to move; that is the change author's call. This is the only reason the Docker criterion is not fully green. |
| `npm run lint` — 2 errors in `apps/web/src/views/TournamentDetailView.vue` | Commit `878bf24` | An unused `toggleChoice`, and a parse error from double-encoded UTF-8. Three of those sequences are user-visible. |

## Approved scope (local and test environments only)

- Course authoring with the section 12.10 lifecycle and publication completeness validation.
- Explicit lesson ordering with prerequisite locks enforced in the payload.
- Free enrolment, entitlement-linked access, monotonic progress, and deterministic completion.
- Moderated course reviews restricted to eligible enrolments.
- Coach profiles limited to approved public fields.
- Learner catalog, course detail, player, and the education console, in fa and en.

## Excluded scope

- Paid course enrolment in any environment where `PAID_COURSES_ENABLED` is not deliberately set. It ships `false`.
- Any Toman course price. Course pricing is Dragon Coin only.
- Refunds of any kind for a course.
- Quizzes, exercises, and any graded assessment.
- Certification, accreditation, and coach payout (EDU-012).
- `/coaches/{slug}` (PAGE-033) and course revenue reporting (ANALYTICS-004).

## Blocked / disabled capability inventory

| Capability | Gate or decision | Shipped state |
|---|---|---|
| Paid course enrolment | OD-015 | `PAID_COURSES_ENABLED` ships `false`; pricing is refused at authoring |
| Toman course price | OD-015 | Refused by name; Dragon Coin only |
| Course refunds | OD-015 | Not implemented; revocation records itself and moves no money |
| Coach commercial terms | OD-015 | Not modelled anywhere |
| Coach authoring console | OD-015 | Not built; ownership is modelled and enforced at publication |
| Coach profile page | OD-015 | Deferred; approved fields shown unlinked on the course detail |
| Course revenue reports | OD-015 | Deferred; revenue cannot reconcile while paid enrolment is gated |
| Quiz and exercise lessons | OD-016 | Refused at authoring with the decision named |
| Certification and accreditation | EDU-012 | No endpoint, field, or promise exists |
| Coach payout | EDU-012 | No endpoint exists |

## Gates that must flip before a Phase 3 GO is reconsidered

- `PAID_COURSES_ENABLED` — requires an approved ownership, refund, and coach-terms policy.
- `PAYMENTS_MOCK_ENABLED` — a real Phase 3 release needs a real payment provider, not the deterministic mock.
- `NOTIFICATIONS_SMS_ENABLED` — remains OD-008-gated; course completion is in-app only, which is deliberate.

## Conditions for reconsidering the verdict

1. OD-015 resolved: coach onboarding, content ownership, paid-course refund, access revocation, and coach commercial terms approved and recorded.
2. OD-016 resolved: a decision on quizzes and exercises, and an approved exercise-type list if they are required.
3. A live payment provider integrated and validated, replacing the deterministic mock.
4. Manual accessibility certification of the catalog, detail, and player surfaces, which local automation does not replace.
5. Production capacity evidence for the course player and catalog under real load.
6. Authorized human sign-off, on the same basis Phase 1 and Phase 2 require.

Production deployment authorized: **NO**. Awaiting authorized human sign-off.

## Honest characterisation

Everything verified here ran against deterministic mock adapters on a local stack.
"Payment" throughout Phase 3 means the in-repository mock provider and the Dragon Coin
ledger; no external payment provider was ever contacted, and no claim is made about how one
would behave. The paid journey proves the platform's own reservation, capture, and
entitlement logic — not a payment integration.
