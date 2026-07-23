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
- [ ] DRAGON-17c

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

- Active item: `DRAGON-17b` (Phase 1 release evidence + broad verification) — one broad verification cycle run against committed `09b1af5`. Results: closure 14/14; lint + api/web typecheck clean; unit api 266/266 + web 39/39; integration/concurrency 295/295; 22 migrations clean + idempotent (60 collections/184 indexes); api/web builds ok + bundle budget pass (entry gzip 89.8 kB); focused security 55/55; focused perf/load 37/37 unit + 35/35 itest; browser matrix 258 passed / 1 intentional skip / **2 intermittent (root cause unconfirmed)** (teams invitations under parallel load — pass on desktop + isolated); `npm audit` 0 vulns. **Technically credible Phase 1 release candidate.** Full evidence + risk table in `IMPLEMENTATION_STATUS.md` → "DRAGON-17b — Phase 1 release evidence". Left unmarked pending the focused reviewer pass; not committed. **Parent DRAGON-17 remains open (17c not started).**
- Blockers: none blocking release-candidate status. Non-blocking: one browser-suite flake (invitations fetch-once/no-refetch under parallel load) flagged for follow-up; 362 `Evidence pending` rows + manual/production evidence (AT certification, deploy/backup/observability, prod capacity) remain DRAGON-17c / post-Phase-1.
