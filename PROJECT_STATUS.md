# Dragon Ecosystem Project Status

Mark an item complete only after its implementation is reviewed, relevant checks pass, and the status change is included in the final commit for that item.

Sliced parents (`09`, `11`, `16`, `17`, `27`) are never executed as separate implementation prompts. Complete their `a`, `b`, and `c` slices in order.

## Foundation and Phase 1

- [x] DRAGON-00
- [x] DRAGON-01
- [x] DRAGON-02
- [x] DRAGON-03
- [x] DRAGON-04
- [x] DRAGON-05
- [x] DRAGON-06
- [x] DRAGON-07
- [x] DRAGON-08
- [x] DRAGON-09a
- [x] DRAGON-09b
- [x] DRAGON-09c
- [x] DRAGON-10
- [x] DRAGON-11a
- [x] DRAGON-11b
- [x] DRAGON-11c
- [x] DRAGON-12
- [x] DRAGON-13
- [x] DRAGON-14
- [x] DRAGON-15
- [x] DRAGON-16a
- [x] DRAGON-16b
- [x] DRAGON-16c
- [x] DRAGON-17a
- [x] DRAGON-17b
- [x] DRAGON-17c

## Later phases

- [x] DRAGON-18
- [x] DRAGON-19
- [x] DRAGON-20
- [x] DRAGON-21
- [ ] DRAGON-22
- [ ] DRAGON-23
- [ ] DRAGON-24
- [ ] DRAGON-25
- [ ] DRAGON-26
- [ ] DRAGON-27a
- [ ] DRAGON-27b
- [ ] DRAGON-27c

## Current work

- Active item: `DRAGON-21` (Phase 3 education release closure). Phase 3 hardened and evidenced: the paid course journey now runs end to end in fa and en (buy Dragon Coin through the mock provider, reserve, capture, reach the lessons), with payment failure, a replayed provider callback, access denial, progress persistence, and completion each covered. Course completion publishes through the shared notifications outbox; a course capture is reconciled against the shared ledger; the player is verified at the 320px floor with a real navigation landmark; Mongo persistence passes. **Phase 3 release decision: NO-GO**, recorded in `RELEASE_DECISION_PHASE3.md` — blocked entirely by OD-015 (ownership, refund, revocation, coach commercial terms) and OD-016 (quiz/exercise scope), with **no implementation failure outstanding**.
- Previous item: `DRAGON-20` (Phase 3 courses, enrolment, and progress). Course authoring with a five-state lifecycle and publication completeness checks, explicit lesson ordering with prerequisite locks, free and paid enrolment with an entitlement link, monotonic per-lesson progress, deterministic completion, moderated reviews, and approved-fields-only coach profiles. Learner catalog, course detail, player, and an education console, all bilingual. **Both open decisions stay closed:** OD-015 keeps paid enrolment gated off (`PAID_COURSES_ENABLED=false`) and a Toman price refused; OD-016 keeps quiz and exercise lesson types refused. PAGE-033 (coach page) and ANALYTICS-004 (course revenue reports) are deferred behind OD-015 and rowed as such.
- Previous item: `DRAGON-19` (Phase 2 live chat, moderation, and release). Moderated live chat delivered end to end: rooms linked to streams with a moderation scope, totally-ordered messages over a per-room sequence, server-side duplicate protection, rate-limited sending with backpressure, room-scoped timeouts and bans, message removal with retained evidence, and reports that open shared moderation cases. **Phase 2 release decision: NO-GO**, recorded in `RELEASE_DECISION_PHASE2.md` — blocked entirely by external decisions (OD-013 contracted Arvan capabilities, OD-014 rights/takedown/archive policy, INT-004 credentials), with **no implementation failure outstanding**. Phase 2 parent remains open pending those decisions and authorized human sign-off.
- Previous item: `DRAGON-18` (Phase 2 stream catalog and Arvan adapter). Stream module delivered end to end: Dragon-owned stream identity/schedule/relationships/access policy, the full seven-state lifecycle, a provider adapter boundary with a deterministic stub, idempotent provisioning, operator reconciliation, degraded-state handling with operator alerts, rights confirmation before scheduling, and localized fa/en discovery, watch, and operations pages. **Both open decisions stay closed:** OD-013 keeps every Arvan-specific behaviour out (`STREAMING_PROVIDER=arvan` fails startup), and OD-014 keeps archive publication and takedown refused (`STREAM_RIGHTS_POLICY_APPROVED=false`). STREAM-010 (highlights) and STREAM-012 (provider playback analytics) are deferred behind those gates and rowed as such. Live chat (CHAT-*) is DRAGON-19 and was not started.
- Previous item: `DRAGON-17c` (Phase 1 release decision + acceptance closure) — decision recorded in `RELEASE_DECISION.md`, validated by `npm run decision:check` (12/12). **Decision: GO WITH CONDITIONS** for the local/test release candidate at `09b1af5` (mock-provider, in-app notifications, free + gated-paid flows, fa/en, 3 viewports, ≤1,000 capacity). **Production deployment NOT authorized. Final Phase 1 acceptance withheld** — 362 `Evidence pending` rows undispositioned (no repository-authorized waiver exists), manual AT + production deploy/backup/observability/load evidence absent. **Awaiting authorized human sign-off.** DRAGON-17b complete + committed (`45272f1`). Left unmarked pending the focused reviewer pass; not committed.
- Blockers: **local/test RC = none.** Staging/production/final-acceptance blocked by conditions C1–C5 in `RELEASE_DECISION.md` (disposition 362 rows; AT certification; deploy/backup/observability rehearsal; production load; human sign-off). Non-blocking tracked: intermittent `teams.spec.ts:58` (C6/R-FLAKE).
