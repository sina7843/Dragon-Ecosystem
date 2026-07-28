# Phase 2 Release Decision — streaming and moderated live chat

Recorded by DRAGON-19 on 2026-07-28. Scope: Phase 2 (GOAL-006) only. Phase 1's decision is
separate and unchanged in `RELEASE_DECISION.md`.

Baseline commit: `878bf24`. Phase 2 work (DRAGON-18 + DRAGON-19) is implemented and verified
on top of it and is **not yet committed**.

## Decision: NO-GO

Phase 2 must not be released.

The verdict is **not** driven by a defect. Every implementation acceptance criterion in
DRAGON-18 and DRAGON-19 is met and verified, and no Critical or High implementation finding
is outstanding. Phase 2 is blocked by two unresolved external decisions, both classified as
release-blockers by the prompt's own gate table, and by the absence of the contracted
provider they depend on.

Releasing Phase 2 today would ship a streaming product whose video delivery has never been
run against the provider that is supposed to deliver it, and whose rights, retention, and
takedown policy has not been approved by the people who own that decision.

## External blockers (not implementation failures)

| Blocker | Owner | What is missing | Effect if released anyway |
|---|---|---|---|
| OD-013 | Streaming operations | Confirmed Arvan Cloud live, player, API, secure-link, archive, geographic, analytics, and service-level capabilities | Video delivery has no contracted implementation. The active provider is a deterministic local stub that performs no network call and plays no video. |
| OD-014 | Legal and content | Approved stream rights, takedown, archive duration, and geographic access policy | Archive publication and takedown are refused by the platform. A completed broadcast cannot be archived, and content cannot be pulled under a policy that does not exist. |
| INT-004 | Streaming operations | A machine credential with minimum scope, and sandbox validation of the API and player | TEST-020's contracted integration test cannot be written. Nothing here has ever exercised real provider behaviour. |

None of these can be closed by engineering. Each requires a decision or a contract from
outside the repository.

## Implementation failures blocking release

**None.**

The deterministic suites are green on the Phase 2 branch state:

- `npm run typecheck` — pass (both workspaces)
- `npm test` — 358 tests: 357 passed, 1 failed; the single failure is pre-existing and unrelated (see below)
- `npm run test:integration` — 357 passed, 0 failed
- `npm run build` — pass
- `npm run test:budget` — pass
- `npm run e2e` — 308 passed, 1 skipped, 0 failed, across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL and en LTR
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12 (Phase 1 document, unchanged)

One focused independent security review was run over the chat and streams surfaces. Verdict:
**APPROVE, no Critical or High finding.** The single Medium — missing regression tests for
cross-room IDOR on the mutating restriction routes — was resolved by adding three tests
before this decision was recorded. Two Lows were recorded in code rather than built.

## Pre-existing repository failures, separated from this work

These predate DRAGON-18/19, were not introduced or fixed here, and are not Phase 2 release
blockers. They are listed so the verdict above is not read as "everything is green".

| Failure | Origin | Note |
|---|---|---|
| `compose-topology.test.ts` "nginx remains the public entry point on 8080" | Uncommitted working-tree change to `docker-compose.yml` (`"${WEB_PORT:-8080}:8080"`) | The test asserts a literal `8080:8080`. Either the test or the compose change needs to move; that is the change author's call. |
| `npm run lint` — 2 errors in `apps/web/src/views/TournamentDetailView.vue` | Commit `878bf24` | An unused `toggleChoice`, and a parse error from double-encoded UTF-8. Three of those sequences are user-visible (page title, champion trophy, standings dash). |

## Approved scope (local and test environments only)

- Stream catalog: Dragon-owned identity, schedule, relationships, access policy, and the full seven-state lifecycle.
- Public discovery and watch pages in fa and en, with server-side access validation before any player data is issued.
- Provider adapter boundary with a deterministic in-repository stub; idempotent provisioning and operator reconciliation.
- Moderated live chat: ordered messages, at-least-once delivery with client deduplication, rate-limited sending, room-scoped timeouts and bans, message removal with retained evidence, and reports that open shared moderation cases.
- Chat moderation console and stream operations console, both permission-gated and audited.

## Excluded scope

- Any real video delivery, player, or secure-link behaviour. `STREAMING_PROVIDER=arvan` fails startup on purpose.
- VOD publication, archive retention, highlights, geographic access control, and takedown — all gated by `STREAM_RIGHTS_POLICY_APPROVED`, which ships `false`.
- Provider playback analytics and provider-startup performance measurement.
- The `/channels/{slug}` page (PAGE-029): no channel entity exists, and the archives and highlights it is defined to show are gated off.
- The provider sync webhook (API-071): a callback needs a contracted authentication scheme.
- Private direct messaging — prohibited by CHAT-008 and asserted absent by a route-registry guardrail.

## Blocked / disabled capability inventory

| Capability | Gate or decision | Shipped state |
|---|---|---|
| Arvan video delivery | OD-013 | Not implemented; provider selection refuses `arvan` at startup |
| Provider player / embed | OD-013 | Local stub issues a signed expiring link; no player is mounted |
| Provider secure link | OD-013 | Stub HMAC abstraction only, bound to viewer scope and expiry |
| Provider sync webhook | OD-013 | Not registered; operator-triggered reconciliation instead |
| Provider playback analytics | OD-013 | Not implemented |
| Provider startup performance | OD-013 | Not measurable |
| Contracted provider integration test | OD-013 | Cannot be written; explicitly not simulated |
| VOD archive publication | OD-014 | Refused; a disabled archive creates no public VOD |
| Archive retention duration | OD-014 | No approved duration; policy forced to `disabled` |
| Content takedown | OD-014 | Refused with a message naming the decision |
| Geographic access control | OD-014 | Not implemented; no field is offered |
| Highlights | OD-014 | Not implemented; source VOD is gated off |
| Channel page | OD-014 | Deferred; no channel entity |
| Paid stream access | ASM-011 | Future scope; no representation in the access model |
| Private direct messaging | CHAT-008 | Prohibited; absence asserted by a route-registry guardrail |

## Gates that must flip before a Phase 2 GO is reconsidered

- `STREAMING_PROVIDER` — a contracted provider must exist and be selectable without failing startup.
- `STREAM_RIGHTS_POLICY_APPROVED` — must be approved and turned on, with an approved retention duration.
- `STREAM_SECURE_LINK_SECRET` — must be a real deployment secret, not the development placeholder.
- `NOTIFICATIONS_SMS_ENABLED` — remains OD-008-gated for stream schedule alerts; in-app notification is unaffected.

## Conditions for reconsidering the verdict

1. OD-013 resolved: contracted Arvan capabilities confirmed and validated in a sandbox, with a scoped machine credential issued.
2. OD-014 resolved: stream rights, archive duration, takedown, and geographic access policy approved, and the retention duration recorded.
3. TEST-020 satisfied: at least one contracted Arvan integration test written and passing against the real provider.
4. PERF-011 and PERF-012 measured against the approved room concurrency and a real player, not a stub.
5. Manual accessibility certification of the watch and chat surfaces, which local automation does not replace.
6. Authorized human sign-off, on the same basis Phase 1 requires.

Production deployment authorized: **NO**. Awaiting authorized human sign-off.

## Honest characterisation

Everything verified here ran against deterministic mock adapters and a local stack. Nothing
in this document claims that any external provider behaved in any particular way, because no
external provider was ever contacted. The stub proves the shape of provisioning, secure
links, reconciliation, and failure handling; it proves nothing about Arvan Cloud.
