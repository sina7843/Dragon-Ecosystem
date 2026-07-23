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

- [ ] DRAGON-18
- [ ] DRAGON-19
- [ ] DRAGON-20
- [ ] DRAGON-21
- [ ] DRAGON-22
- [ ] DRAGON-23
- [ ] DRAGON-24
- [ ] DRAGON-25
- [ ] DRAGON-26
- [ ] DRAGON-27a
- [ ] DRAGON-27b
- [ ] DRAGON-27c

## Current work

- Active item: `DRAGON-17c` (Phase 1 release decision + acceptance closure) — decision recorded in `RELEASE_DECISION.md`, validated by `npm run decision:check` (12/12). **Decision: GO WITH CONDITIONS** for the local/test release candidate at `09b1af5` (mock-provider, in-app notifications, free + gated-paid flows, fa/en, 3 viewports, ≤1,000 capacity). **Production deployment NOT authorized. Final Phase 1 acceptance withheld** — 362 `Evidence pending` rows undispositioned (no repository-authorized waiver exists), manual AT + production deploy/backup/observability/load evidence absent. **Awaiting authorized human sign-off.** DRAGON-17b complete + committed (`45272f1`). Left unmarked pending the focused reviewer pass; not committed.
- Blockers: **local/test RC = none.** Staging/production/final-acceptance blocked by conditions C1–C5 in `RELEASE_DECISION.md` (disposition 362 rows; AT certification; deploy/backup/observability rehearsal; production load; human sign-off). Non-blocking tracked: intermittent `teams.spec.ts:58` (C6/R-FLAKE).
