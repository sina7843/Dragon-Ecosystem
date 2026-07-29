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
- [x] DRAGON-22
- [x] DRAGON-23
- [x] DRAGON-24
- [x] DRAGON-25
- [x] DRAGON-26
- [ ] DRAGON-27a
- [ ] DRAGON-27b
- [ ] DRAGON-27c

## Current work

- Active item: `DRAGON-26` (Phase 5 commerce and economy release closure). Phase 5 traceability completed and corrected: twelve rows that had sat "Evidence pending" since DRAGON-17a are now evidenced against the code that satisfies them (PAYOUT-001/002/003, REWARD-001/008, DATA-070/071, PAGE-058/059, ROLE-022, BR-022, JOURNEY-008), and eight requirements that had no row at all were added (GOAL-009, UC-020/021, JOURNEY-007, DATA-072, API-095/096, PAGE-042). Four deviations are recorded rather than hidden: a payout is modelled as the prize entitlement record with `/admin/entitlements/…` paths, there is no mixed-payment order, prize entitlements live on the wallet page, and `/account/payouts` is not built. **Phase 5 release decision: NO-GO**, recorded in `RELEASE_DECISION_PHASE5.md` — blocked entirely by OD-019 (physical commerce), OD-020 (affected digital products), and OD-030 (peer commerce), with **no implementation failure outstanding**; the two Critical and one High findings from the DRAGON-25 review are fixed and regression-tested. Docker healthy, Mongo persistence PASS, lint clean.
- Previous item: `DRAGON-25` (Phase 5 economy, rewards, peer transfer, and payouts). A new `economy` module (migration `029-economy`) with reward rules and grants, direct user-to-user Dragon Coin transfer, atomic rolling-window limits with a manual-review hold, and a ledger reconciliation report; plus payout hardening in `prizes`: the full nine-state lifecycle, actor-level dual control, recipient verification before settlement, retry on the same record, reversal that preserves the original evidence, and a report reconciling definition → allocation → ledger → settlement. **Cash redemption, sell-back, an exchange rate, and order-book trading are absent, not gated** — proven three ways, including that the ledger has no transaction type that could balance a cash-out. OD-030 keeps peer *commerce* out while plain transfer, which DEC-022/023 approve, is enabled. The security review returned **REQUEST-CHANGES with two Critical and one High**; all three were real, are fixed, and each has a regression test: a dual-control bypass reachable by failing then retrying a never-approved payout, a double ledger posting when two requests raced under one idempotency key, and rolling-window limits that were read-then-decided rather than claimed. PAGE-043 (`/account/payouts`) is deliberately not built.
- Previous item: `DRAGON-24` (Phase 5 store catalog, inventory, and fulfillment). A `store` module (migration `028-store`) delivering the localized physical/digital catalog with variants and SKUs, auditable internal stock, versioned discounts, a versioned cart, idempotent checkout, immutable order snapshots, internal fulfillment states, digital entitlements, and a financial reconciliation report. Settlement is Dragon Coin through the shared holds boundary — the store never posts to the ledger itself, which is the ROLE-021 boundary. Stock is claimed by a conditional `$inc` inside the write transaction, so two buyers racing for the last unit produce exactly one order; a payment that cannot be funded returns the stock and grants nothing. **Both open decisions stay closed:** OD-019 keeps physical items authorable and browsable but **not purchasable** (`PHYSICAL_FULFILLMENT_ENABLED=false`) because selling one commits us to a delivery with no approved carrier, region, rate, or service level, and no carrier concept exists in the code at all; OD-020 keeps entitlement revocation absent — no route, no state. There is no returns, refund, or RMA surface anywhere (COMMERCE-010, DEC-034). Prize and payout requirements (PAYOUT-001..012, API-095/096) are **not** in this slice. One known limitation is recorded rather than hidden: a process crash between the order commit and the coin capture leaves stock claimed on a stuck order — a shared characteristic of the existing holds integration that needs one sweeper across all purchase flows.
- Previous item: `DRAGON-23` (Phase 4 community release closure). Phase 4 traceability corrected and evidenced: several DRAGON-22 rows had been mapped to the wrong requirement text (SOCIAL-011 is per-channel notification preferences, not privacy-by-default; MOD-008 is the appeal gate, not the report workflow; NOTIF-011 is push, not mentions) and now say what the requirement actually says. Closed three evidence gaps: rendered post bodies and composers carry `dir="auto"` so a Persian post inside the English feed keeps its own direction (SOCIAL-004), guardrails prove community content has no leak path through global search, and the JOURNEY-006 loop — discover, follow, publish, react, comment, unfollow — runs end to end in fa and en. Two path deviations are recorded rather than hidden: the report intake is `/social/reports` (the requirement's `/reports` is already taken by the moderation module, and colliding crashes startup), and the social profile lives on the existing `/players/{username}` page because SOCIAL-001 requires existing profile URLs to stay valid. **Phase 4 release decision: NO-GO**, recorded in `RELEASE_DECISION_PHASE4.md` — blocked entirely by OD-017 (blocking, muting, privacy defaults), OD-024 (appeals), and OD-027 (push), with **no implementation failure outstanding**. Docker healthy, Mongo persistence PASS, lint clean.
- Previous item: `DRAGON-22` (Phase 4 community and advanced team roles). Follow relationships for users, teams, and games; posts, comments, and reactions; a visibility-aware feed; reporting into the shared moderation case workflow; a community moderation console; and social profiles whose statistics state their own source. Visibility is decided on every read (BR-025) — nothing is fanned out, so unfollowing or narrowing a profile takes effect on the next request with no rebuild. Advanced team roles (`manager`, `captain`) are two new values of the existing per-membership `role` field, so **no team migration exists** and every Phase 1 team id, membership id, and roster snapshot survives untouched. **All three open decisions stay closed:** OD-017 keeps blocking and muting *absent* rather than merely disabled (`SOCIAL_BLOCKING_ENABLED=false`, guardrail-tested against the route registry and the module's own collections), OD-024 keeps appeals off, and OD-027 keeps push out of the notification channel map. ANALYTICS-005 (community analytics) is deferred and rowed as such. Two real defects were found by the new tests and fixed in the product rather than the test: an over-long post body was silently truncated, and `POST /reports` collided with the moderation module's existing route (a startup crash) — a route-registry guardrail now covers every module.
- Previous item: `DRAGON-21` (Phase 3 education release closure). Phase 3 hardened and evidenced: the paid course journey now runs end to end in fa and en (buy Dragon Coin through the mock provider, reserve, capture, reach the lessons), with payment failure, a replayed provider callback, access denial, progress persistence, and completion each covered. Course completion publishes through the shared notifications outbox; a course capture is reconciled against the shared ledger; the player is verified at the 320px floor with a real navigation landmark; Mongo persistence passes. **Phase 3 release decision: NO-GO**, recorded in `RELEASE_DECISION_PHASE3.md` — blocked entirely by OD-015 (ownership, refund, revocation, coach commercial terms) and OD-016 (quiz/exercise scope), with **no implementation failure outstanding**.
- Previous item: `DRAGON-20` (Phase 3 courses, enrolment, and progress). Course authoring with a five-state lifecycle and publication completeness checks, explicit lesson ordering with prerequisite locks, free and paid enrolment with an entitlement link, monotonic per-lesson progress, deterministic completion, moderated reviews, and approved-fields-only coach profiles. Learner catalog, course detail, player, and an education console, all bilingual. **Both open decisions stay closed:** OD-015 keeps paid enrolment gated off (`PAID_COURSES_ENABLED=false`) and a Toman price refused; OD-016 keeps quiz and exercise lesson types refused. PAGE-033 (coach page) and ANALYTICS-004 (course revenue reports) are deferred behind OD-015 and rowed as such.
- Previous item: `DRAGON-19` (Phase 2 live chat, moderation, and release). Moderated live chat delivered end to end: rooms linked to streams with a moderation scope, totally-ordered messages over a per-room sequence, server-side duplicate protection, rate-limited sending with backpressure, room-scoped timeouts and bans, message removal with retained evidence, and reports that open shared moderation cases. **Phase 2 release decision: NO-GO**, recorded in `RELEASE_DECISION_PHASE2.md` — blocked entirely by external decisions (OD-013 contracted Arvan capabilities, OD-014 rights/takedown/archive policy, INT-004 credentials), with **no implementation failure outstanding**. Phase 2 parent remains open pending those decisions and authorized human sign-off.
- Previous item: `DRAGON-18` (Phase 2 stream catalog and Arvan adapter). Stream module delivered end to end: Dragon-owned stream identity/schedule/relationships/access policy, the full seven-state lifecycle, a provider adapter boundary with a deterministic stub, idempotent provisioning, operator reconciliation, degraded-state handling with operator alerts, rights confirmation before scheduling, and localized fa/en discovery, watch, and operations pages. **Both open decisions stay closed:** OD-013 keeps every Arvan-specific behaviour out (`STREAMING_PROVIDER=arvan` fails startup), and OD-014 keeps archive publication and takedown refused (`STREAM_RIGHTS_POLICY_APPROVED=false`). STREAM-010 (highlights) and STREAM-012 (provider playback analytics) are deferred behind those gates and rowed as such. Live chat (CHAT-*) is DRAGON-19 and was not started.
- Previous item: `DRAGON-17c` (Phase 1 release decision + acceptance closure) — decision recorded in `RELEASE_DECISION.md`, validated by `npm run decision:check` (12/12). **Decision: GO WITH CONDITIONS** for the local/test release candidate at `09b1af5` (mock-provider, in-app notifications, free + gated-paid flows, fa/en, 3 viewports, ≤1,000 capacity). **Production deployment NOT authorized. Final Phase 1 acceptance withheld** — 362 `Evidence pending` rows undispositioned (no repository-authorized waiver exists), manual AT + production deploy/backup/observability/load evidence absent. **Awaiting authorized human sign-off.** DRAGON-17b complete + committed (`45272f1`). Left unmarked pending the focused reviewer pass; not committed.
- Blockers: **local/test RC = none.** Staging/production/final-acceptance blocked by conditions C1–C5 in `RELEASE_DECISION.md` (disposition 362 rows; AT certification; deploy/backup/observability rehearsal; production load; human sign-off). Non-blocking tracked: intermittent `teams.spec.ts:58` (C6/R-FLAKE).
