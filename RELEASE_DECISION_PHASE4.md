# Phase 4 Release Decision — social graph, community, and advanced team roles

Recorded by DRAGON-23 on 2026-07-29. Scope: Phase 4 (GOAL-008) only. Phase 1's decision is
in `RELEASE_DECISION.md`, Phase 2's in `RELEASE_DECISION_PHASE2.md`, and Phase 3's in
`RELEASE_DECISION_PHASE3.md`; none of them is changed by this document.

Tested commit: `c1cdd9a` (DRAGON-22, "feat: add community social graph and advanced team
roles"). The DRAGON-23 corrections and evidence in this document sit on top of `c1cdd9a`
and are **not yet committed**.

## Decision: NO-GO

Phase 4 must not be released.

As with Phase 2 and Phase 3, the verdict is **not** driven by a defect. Every
implementation acceptance criterion in DRAGON-22 and DRAGON-23 is met and verified, the
deterministic suites are green, and no Critical or High implementation finding is
outstanding. Phase 4 is blocked by three unresolved external decisions, all three
classified as release-blockers by this prompt's own gate table.

The decisive one is OD-017. SOCIAL-003 requires the feed to enforce **block and mute**
rules on every read. There are no such rules to enforce, because nobody has approved what
blocking means, what muting means, or what a social profile's privacy defaults should be.
Releasing Phase 4 today would put a public posting surface in front of users while the
only safety remedy available to them is "report it and wait" — with no way to stop a
specific person from reaching them. That is a trust-and-safety decision, not an
engineering one, and shipping without it would be shipping a known gap in user protection.

## External blockers (not implementation failures)

| Blocker | Owner | What is missing | Effect if released anyway |
|---|---|---|---|
| OD-017 | Trust and safety | Approved definitions for blocking, muting, appeals, and social-profile privacy defaults | Users can follow, post, comment, and react, but **cannot block or mute anyone**. The only remedy against a specific person is a report to a moderator. SOCIAL-003's block/mute clause is unenforceable and SOCIAL-006's "blocked user cannot force a notification" is vacuous. |
| OD-024 | Trust and safety | Moderation-appeal eligibility, window, reviewer separation, and finality | A removal is final in practice. There is no appeal route, record, or case transition, and the moderation console says so plainly rather than offering a control that would drop the appeal on the floor. |
| OD-027 | Product and operations | Selected web-push provider and supported platforms | No push channel exists. Mentions and other community events are recorded in-app only. No claim of push support is made anywhere in the product or its documentation. |

None can be closed by engineering. All three require a product, legal, or trust-and-safety
decision.

## Implementation failures blocking release

**None.**

Two real defects were found by DRAGON-22's own tests and fixed in the product rather than
in the test: an over-long post body was silently truncated (now rejected, because storing
the first 2000 characters publishes words the author did not write), and `POST /reports`
collided with the moderation module's existing route, which is a Fastify duplicate-route
crash at startup. The second is worth naming because it escaped the module suite —
moderation's routes register inside `if (deps.tournaments !== undefined)`, so a suite
without tournaments never sees them. A route-registry guardrail now scans every module for
duplicate `(method, path)` pairs regardless of composition, and the Compose stack starting
healthy is independent confirmation.

## Verification run for this decision

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — **0 errors**, 63 warnings (all pre-existing formatting warnings in files this phase did not add)
- `npm test` — **411 passed, 0 failed**
- `npm run test:integration` — **424 passed, 0 failed**
- `npm run build` — pass · `npm run test:budget` — pass (entry bundle 357.96 kB, unchanged; all four community views are lazy route chunks)
- `npm run e2e` — **398 passed, 1 skipped, 0 failed**, across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL and en LTR
- `npm run docker:up` — web, api, and mongo all **healthy**; nginx remains the single published entry point
- `npm run verify:persistence` — **PASS**: committed MongoDB data survived a Compose stop/start on the named volume
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12

### Phase 4 acceptance criteria, evidenced

| Criterion | Evidence |
|---|---|
| Follow → publish → interact → report → moderate, fa + en | `community.spec.ts` JOURNEY-006 — discover a player, follow, the followers-only post arrives, react, comment, then unfollow and it leaves again on the next read |
| Visibility filtering | `social.itest.ts` — a followers-only post reaches a follower and nobody else; unfollowing and narrowing a profile each remove it on the next read with no rebuild (BR-025) |
| Private-id probing | `social.itest.ts` — an invisible post answers 404, never 403, so a private id is indistinguishable from a missing one |
| Advanced team permissions | `community.spec.ts` — a captain captures a roster snapshot but is refused team settings, delegation, and ownership transfer; `teams.itest.ts` — seven delegated-role cases including "a captain cannot strip the manager who appointed them" |
| Team history preserved | `teams.itest.ts` — promotion leaves the membership id and `joinedAt` unchanged and creates no second row; there is no Phase 4 team migration at all |
| Moderation | `community.spec.ts` — a report reaches the shared console and a moderator removes the post with a required reason, the record surviving with its body as evidence |
| No direct messages or private group chat | `social.test.ts` and `chat.test.ts` — the guardrail scans every `routes.ts` and `server.ts` path literal, so a DM endpoint could not exist without failing the test |
| No search leakage | `social.test.ts` — global search queries no community source and no community search route exists |
| Direction-aware posts | `community.spec.ts` — a Persian post inside the English feed resolves to `rtl`, asserted through the computed direction rather than the attribute |
| Accessibility | `community.spec.ts` — one `h1`, `label[for]` association for every composer control, correct `dir` per locale, no raw i18n keys; the whole suite runs the shared primitive a11y matrix |
| Performance | Keyset cursor pagination with compound indexes on every community read path (`social/collections.ts`); the entry bundle is unchanged and all community views are lazy chunks. **No load test was run** — see the honest characterisation below |
| Docker | `npm run docker:up` — all three services healthy; `compose-topology.test.ts` asserts nginx is the only service publishing a host port |
| Mongo persistence | `npm run verify:persistence` — PASS |
| Notifications | `social.test.ts` — the mention event is a transactional template consumed by the shared service, so it inherits the same per-channel preference and gate checks; the social module owns no notification table (NOTIF-010) |
| Localization | Both locales key-parallel (`locales.test.ts`); every community browser test asserts no raw i18n key leaks |

### OD-017 / OD-024 / OD-027 remain disabled, with no misleading UI

- Blocking and muting are **absent, not disabled**. `social.test.ts` asserts that no registered route, no social collection, and no social index names blocking or muting. SOCIAL-008 forbids *partial* activation, and a disabled endpoint over a real block table would already be partial activation.
- The community feed states plainly that blocking is unavailable and that a report is the current remedy, rendered from the server's reported configuration rather than a build-time constant.
- Appeals are absent: no route, no record, no case transition. The moderation console says a removal cannot yet be challenged instead of offering an inert control.
- `push` appears in no entry of the event-to-template map, asserted directly. No token store, provider adapter, or opt-in surface exists, and no documentation claims push support.

## Independent review of this decision

One focused `test-reviewer` release-and-security pass over the verdict, the Phase 4
traceability rows, the community security surface, and the new evidence:
**no Critical and no High security findings**, and the verdict itself was confirmed
honest — every capability this document calls absent was verified absent in the code, the
three gate defaults were verified fail-closed in both `config.ts` and `.env.example`, and
every evidence row was checked to point at a test that exists and asserts what the row
says. The `dir="auto"` change was confirmed to render through Vue interpolation and never
`v-html`, so it introduces no injection vector.

The reviewer found three **traceability-accuracy** defects, all now fixed:

| Defect | Correction |
|---|---|
| `INT-006` was rowed as "community capabilities MUST NOT introduce an external integration" — the opposite of the requirement, which is the push-integration catalog entry (token privacy, opt-in, invalid-token cleanup, retries, sandbox) | Re-rowed against the real text as `Blocked by open decision` under OD-027 |
| `ROLE-019` (community moderator) had **no row at all**, despite the capability shipping in DRAGON-22 | Row added, evidenced by the integration and browser permission tests |
| `TEAM-011` still read `Deferred by phase` even though the delegated-role half shipped | Split to `Partial`: advanced roles done with no migration at all, membership applications not built |

None of the three affects the verdict, which is driven by OD-017, OD-024, and OD-027
rather than by bookkeeping — but they were corrected in the same slice that claims to have
reconciled the Phase 4 rows, because a closure slice that leaves a mismapped row behind has
not closed anything.

The reviewer did not re-execute the suites; the figures above are from the runs recorded in
this document.

## Pre-existing repository failures, separated from this work

**None outstanding.** The two failures separated out by DRAGON-21 — the `compose-topology`
assertion against the intentional `${WEB_PORT:-8080}` change, and the two lint errors in
`TournamentDetailView.vue` — were both fixed by the baseline-cleanup task that preceded
DRAGON-22. `npm run lint` now reports zero errors and `npm test` is fully green.

## Approved scope (local and test environments only)

- Follow and unfollow for users, teams, and games, idempotent and with withdrawn relations retained as history.
- Community posts with an explicit audience defaulting to followers, comments, and reactions.
- A visibility-aware cursor feed over followed authors, re-evaluated on every read.
- Reporting into the shared moderation case workflow with the body snapshotted as evidence.
- Moderator removal with a required reason, retaining the record for the case file.
- Social profiles with opted-in statistics that state their own source and calculation period.
- Delegated team roles: `manager` and `captain`, added to the existing membership model.
- Community feed, post detail, player social section, and the moderation console, in fa and en.

## Excluded scope

- Blocking and muting in any environment. `SOCIAL_BLOCKING_ENABLED` ships `false` and there is nothing behind it.
- Moderation appeals of any kind.
- Web and mobile push notifications.
- Direct messages and private group chat (SOCIAL-012; out of scope unless OD-018 is approved).
- Community analytics and exports (ANALYTICS-005).
- Team membership applications, the second half of TEAM-011.
- Feed filters, and the teams/match-history sections of the social profile (PAGE-034, PAGE-035).

## Blocked / disabled capability inventory

| Capability | Gate or decision | Shipped state |
|---|---|---|
| Blocking a user | OD-017 | Absent: no route, collection, or index. `SOCIAL_BLOCKING_ENABLED` ships `false` |
| Muting a user | OD-017 | Absent, same as blocking |
| Social-profile privacy defaults | OD-017 | Provisional: statistics are hidden until opted in, and a private profile is a 404. Awaiting an approved default |
| Feed block/mute enforcement | OD-017 | Cannot be enforced; no policy exists to enforce |
| Moderation appeals | OD-024 | Absent: no route, record, or case transition. The console states this |
| Web and mobile push | OD-027 | Absent: no channel in the template map, no token store, no adapter |
| Direct messages / private groups | SOCIAL-012, OD-018 | Absent and guardrail-tested against the route registry |
| Community analytics and exports | — | Not built; no leak path exists today, asserted |
| Team membership applications | — | Not built; the role half of TEAM-011 is complete |

## Gates that must flip before a Phase 4 GO is reconsidered

- `SOCIAL_BLOCKING_ENABLED` — requires an approved blocking, muting, and social-privacy policy.
- `MODERATION_APPEALS_ENABLED` — requires approved appeal eligibility, window, reviewer separation, and finality.
- `PUSH_NOTIFICATIONS_ENABLED` — requires a selected provider and supported platforms.

## Conditions for reconsidering the verdict

1. OD-017 resolved: blocking, muting, appeals, and social-profile privacy defaults approved and recorded, then implemented and enforced in the feed.
2. OD-024 resolved: appeal eligibility, window, reviewer separation, and finality approved.
3. OD-027 resolved: a push provider and platform list selected, if push is required at launch.
4. Community analytics (ANALYTICS-005) built, with export privacy rules applied.
5. Manual accessibility certification of the feed, post detail, and moderation console, which local automation does not replace.
6. Production capacity evidence for the feed under real fan-out — the current evidence is structural (keyset pagination and compound indexes), not measured.
7. Authorized human sign-off, on the same basis Phase 1, Phase 2, and Phase 3 require.

Production deployment authorized: **NO**. Awaiting authorized human sign-off.

## Honest characterisation

Everything verified here ran on a local stack with deterministic mock adapters. The
performance claim for the feed is **structural, not measured**: every community read is a
keyset-paginated query against a compound index, and the visibility check is a bounded
per-item lookup, but no load test was run and no figure is offered for feed latency at a
realistic follow-graph size. The visibility model deliberately trades read cost for
correctness — the alternative, a precomputed activity table, is cheaper to read and wrong
the moment a follow or a profile setting changes — and that trade has not been measured
under load. No external provider of any kind was contacted during this phase.
