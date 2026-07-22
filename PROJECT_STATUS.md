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
- [ ] DRAGON-16b
- [x] DRAGON-16c
- [ ] DRAGON-17a
- [ ] DRAGON-17b
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

- Active item: none in progress; next eligible is `DRAGON-16b` (the last remaining DRAGON-16 sibling)
- Last completed item: `DRAGON-16c` (security hardening: CSRF origin guard with production-required PUBLIC_ORIGIN, CSP/HSTS/Permissions-Policy, no-store on API, pseudonym-salt secret, server_tokens off; npm audit 0 vulns) — implemented and verified, not yet committed. DRAGON-15 and DRAGON-16a also complete and not yet committed. **Parent DRAGON-16 remains open (16b performance not started)**
- Blockers: none
