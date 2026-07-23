# Phase 1 Release Decision (DRAGON-17c)

<!-- Canonical, machine-checked release-decision record. Validated by `npm run decision:check`
     (scripts/release-decision.test.mjs). Edit the marked fields carefully — the checker asserts
     the decision vocabulary, tested commit, scopes, gate references, runbook references, and the
     production-authorization / human-sign-off invariants below. -->

- Decision date: 2026-07-23
- Tested commit: `09b1af5` (product code state). Current HEAD `45272f1` sits on top and is **doc-only** (`IMPLEMENTATION_STATUS.md`, `PROJECT_STATUS.md` — no product code change), so the DRAGON-17b evidence applies unchanged to HEAD.
- Evidence reused from: DRAGON-17b broad verification at commit `09b1af5` (see `IMPLEMENTATION_STATUS.md` → "DRAGON-17b — Phase 1 release evidence"). Not re-run here.

## Decision: GO WITH CONDITIONS

The **local/test release candidate at commit `09b1af5` is technically acceptable for a bounded scope**. This is a technical release-candidate approval only. It is **not** final Phase 1 acceptance and it is **not** production deployment authorization. The conditions below are explicit, owned, and enforceable, and they prohibit production deployment and withhold final acceptance until met.

These four readiness states are distinct and are **not** interchangeable:

| Readiness state | Status |
|---|---|
| Technical release-candidate readiness (this commit, local/test) | **Met** (GO WITH CONDITIONS) |
| Final Phase 1 acceptance | **Not accepted** — 362 `Evidence pending` requirements undispositioned; no repository-authorized waiver/sampling policy exists; manual + production evidence absent |
| Production deployment authorization | **Not authorized** |
| Operational readiness (rehearsed) | **Not established** — runbooks documented, not rehearsed |
| External-provider readiness | **Not established** — mock adapters only |

**Production deployment authorized: NO.**
**Human sign-off: Awaiting authorized human sign-off.** A model-generated recommendation is not human acceptance.

## Approved scope

The GO-WITH-CONDITIONS decision applies **only** to:

- the current Git commit `09b1af5` as a **local/test release candidate**;
- **mock-provider-only** operation (payments via the deterministic mock adapter; no live SMS/email/payment/analytics provider);
- **in-app-only** notifications (transactional); OTP SMS is the identity module's own security-essential path;
- **free** tournament registration flows end to end;
- **gated paid** tournament flows exercised only behind `PAID_TOURNAMENTS_ENABLED` with the mock payment adapter (mechanism proven; not a live-payment launch);
- **internal operator primitives** executed by **manual operator action** (no always-on scheduler);
- supported languages **fa (RTL)** and **en (LTR)**;
- supported browser viewports **small-mobile (320)**, **mobile (375)**, **desktop (1440)** on the Chromium engine;
- the approved **global tournament capacity ≤ 1,000 participants**, with format-specific lower limits enforced.

## Excluded scope

Explicitly **not** approved by this decision:

- **staging** deployment;
- **production** deployment (prohibited until the conditions below are met);
- any **live provider** operation (SMS, email, payment, external analytics);
- **paid tournament launch** as a live-money flow;
- **refunds, cash-out, withdrawal, user-to-user transfer, external prize payout** (all fail-closed disabled);
- **account-recovery approval** (triage-only) and any **published support SLA**;
- **always-on** notification/expiry/job scheduling;
- **SSR/prerender**, crawlable-without-JavaScript output, and real HTTP 404 for arbitrary SPA slugs;
- **media derivatives/thumbnails**;
- deployment-owned **TLS termination, backup, restore, observability, and infrastructure**;
- final **Phase 1 requirement acceptance** for the 362 `Evidence pending` rows.

## Conditions (must be met before the excluded scope is authorized)

| # | Condition | Blocks | Owner |
|---|---|---|---|
| C1 | Disposition the 362 `Evidence pending` Phase-1 rows with real per-requirement evidence (no authorized waiver/sampling policy exists in the repository) | Final acceptance | Acceptance owner |
| C2 | Hands-on screen-reader / assistive-technology certification for essential journeys | Final acceptance | Accessibility/QA |
| C3 | Production deployment rehearsal incl. TLS, backup, restore, observability, alert routing | Production, Final acceptance | Deployment/Ops |
| C4 | Production load/latency evidence at the approved limits | Production, Final acceptance | Ops |
| C5 | Authorized human release owner sign-off | Production, Final acceptance | Human release owner |
| C6 | Re-diagnose the intermittent `teams.spec.ts:58` browser failure (non-blocking) | Neither (tracked) | Maintenance/17-followup |

## Requirement acceptance reconciliation (596 Phase 1 dispositions)

Reviewed without bulk-upgrading. Phase-1 canonical inventory = **596** (proven by `npm run closure:check`).

| Disposition | Phase-1 treatment |
|---|---|
| **Verified** | Accepted for Phase 1 (current deterministic evidence exists) |
| **Implemented** | Accepted only as implemented — evidence narrower than required; not final-acceptance-blocking individually, revisit per row |
| **In progress** | Nonblocking but unresolved for RC; **final-acceptance-blocking** until completed |
| **Deferred by phase** | Accepted only as deferred (not part of accepted Phase 1 delivery) |
| **Blocked by open decision** | Accepted only as gated/fail-closed until the decision changes |
| **Evidence pending (362)** | **Final-acceptance-blocking.** Explicitly outside this decision's approved scope. **Not** transferred to Accepted. No repository-authorized risk-based sampling or waiver authority exists, so they cannot be waived here — they are dispositioned individually under DRAGON-17c follow-up / a future acceptance pass (condition C1). |

**Treatment chosen for the 362 rows: "explicitly outside the approved scope" + "reclassified individually using current evidence (deferred to C1)".** A broad passing DRAGON-17b suite does **not** upgrade any `Evidence pending` row. Because the honest acceptance model requires evidence-supported dispositions and no waiver authority exists, **final Phase 1 acceptance is withheld (NO-GO for final acceptance)** while the technical release candidate is GO WITH CONDITIONS.

## Blocked / disabled capability inventory

Gate names below resolve to `apps/api/src/config.ts` and `ENVIRONMENT_VARIABLES.md`; fail-closed codes resolve to the cited modules. None blocks the approved local/test RC scope.

| Capability | Decision ID | Gate / mechanism | Default | Production behavior | Reason disabled | Safe fallback | Enable owner | Work to enable | Blocks RC scope? |
|---|---|---|---|---|---|---|---|---|---|
| Live email delivery | OD-003 | `NOTIFICATIONS_EMAIL_ENABLED` (no email field collected) | off | off | No provider; avoid a verification flow that cannot complete | In-app only; local email sink non-prod | Provider+policy | Provider+code | No |
| Tournament SMS | OD-008 | `NOTIFICATIONS_SMS_ENABLED` | off | off | Consent/template gating | In-app only (OTP SMS separate) | Provider+policy | Provider+code | No |
| Marketing notification classes | OD-008 | `NOTIFICATION_CLASS_DISABLED` (code) | disabled | disabled | Marketing consent must not reuse transactional consent | Transactional in-app only | Policy | Policy+code | No |
| Paid tournament activation | OD-007 | `PAID_TOURNAMENTS_ENABLED` | off | off | Paid templates unapproved | Free flows; gate produces no effect | Acceptance/policy | Policy | No |
| Real payment providers | PAY-012, DEC-050 | mock adapter (`PAYMENTS_MOCK_ENABLED`, non-prod) | mock | no live provider | No integration | Deterministic mock | Provider | Provider+code+security | No |
| Participant / Dragon Coin refunds | OD-007, DEC-050 | `TRANSFER_FEATURE_DISABLED` (`refund_execution`) | disabled | disabled | Fail-closed until launch | No effect | Acceptance | Policy+code | No |
| Cash-out / withdrawal | WALLET-009, DEC-050 | `TRANSFER_FEATURE_DISABLED` (`withdrawal`) | disabled | disabled | No cash rail | No effect | Provider+policy | Provider+code | No |
| User-to-user transfers | DEC-050 | `TRANSFER_FEATURE_DISABLED` (`user_to_user`) | disabled | disabled | Fail-closed | No effect | Policy | Code | No |
| External prize payout | OD-007 | `TRANSFER_FEATURE_DISABLED` (`prize_payout`) | disabled | disabled | Fail-closed | No effect | Provider | Provider+code | No |
| Recovery approval | OD-029 | `RECOVERY_APPROVAL_DISABLED` (triage-only) | disabled | disabled | No supported recovery method | Triage only | Decision/policy | Code+policy | No |
| Published support SLA | OD-023 | none published | none | none | No SLA claim | Best-effort triage | Policy | Policy | No |
| External analytics forwarding | OD-026 | `ANALYTICS_EXTERNAL_ENABLED` + `EXTERNAL_TRACKER_INTEGRATED=false` | off, no tracker | never forwards | No integrated tracker | Internal pseudonymous sink | Provider+policy | Provider+code | No |
| Named rule profiles | OD-006 | custom free-text profile fallback | gated | custom-only | Profiles unapproved | Custom rule profile (publishable) | Policy | Policy+code | No |
| Always-on scheduler | DRAGON-14 (bounded runner) | operator-triggered runner; no daemon | manual | manual/triggered | No scheduler infra in scope | Bounded batch caps | Deployment/Ops | Infra+code | No (ops-owned) |
| SSR/prerender + real wire 404 + crawl-without-JS | SEO reqs | SPA-only render | absent | soft 404 | Phase-1 SPA scope | SPA meta/sitemap/robots | Product/Deployment | Code/infra | No |
| Media derivatives/thumbnails | media reqs | original-only pipeline | absent | original served | Deferred | Content-addressed original | Product | Code | No |
| Reserved-name / username-change policy | OD-028 | format+uniqueness only | n/a | n/a | Policy unresolved | Format+uniqueness validation | Policy | Policy+code | No |
| TLS / backup / restore / observability / infra | deployment boundary | not in repo | absent locally | externally owned | Out of local scope | n/a (deployment) | Deployment/Ops | Infra | No for RC; **Yes for production** |

## Rollback model (actual)

- **Application-version rollback: supported** for code/static assets (redeploy the previous image/bundle) — an operator action, not automated here.
- **Database down-migrations: none exist.** Policy is **forward-fix** (confirmed: no down/rollback logic in `apps/api/src/migrate.ts`, no `*.down.*` scripts; documented in `RUNBOOKS.md` → "Migration rollback and forward-fix"). Destructive schema rollback is **not** implied.
- **Feature-gate disablement** can stop new activity (paid checkout, SMS/email, external analytics, transfers) **without undoing existing data** by flipping the gate off.
- **Migrations `013-ledger`…`022-perf-indexes`** introduce ledger/hold/checkout/prize/notification/moderation/operations/media state; rolling the application back to a pre-migration version while these collections hold data is **unsafe** and unsupported — forward-fix only.
- **Immutable financial/audit data** (double-entry ledger, audit envelope) is corrected by **compensating transactions**, never by deletion or row rewrite (DEC per WALLET-004/005/008).
- **Bracket/result versioning** supports server-side gated rollback (`confirm:true` + reason, refused on locked competitions) per BRACKET-010/013.
- **Failed-deployment recovery / incident comms:** operator-driven; production infra incidents are **externally owned** and have **no tested procedure in this repository**.

## Runbook readiness

Present in `RUNBOOKS.md` (documented, **not rehearsed**):

- "Bootstrap the first super administrator"
- "Migration rollback and forward-fix" (incl. "A stalled migration", "Reversing an applied migration (forward-fix)")
- "Persistence incident (Mongo / ledger / bracket / queue / OTP-mock / payment-mock)"

**Documented gaps (no tested procedure):** stuck holds / checkout expiry, notification dead-letter accumulation, moderation/support incident, operations-job failure, alert acknowledgement, gated-capability disablement checklist, production-only infrastructure escalation. These are **ops/deployment-owned** and are recorded as risks R-RUNBOOK below. A documented procedure is not tested operational readiness.

## Known-risk register

| ID | Description | Affected capability | Evidence | Likelihood | Impact | Mitigation | Owner | Escalation trigger | Blocks RC? | Blocks final acceptance? | Blocks production? | State |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-EVID | 362 Phase-1 `Evidence pending` rows undispositioned | Requirement acceptance | Traceability + closure:check | Certain | High for acceptance | Individual disposition (C1) | Acceptance owner | Acceptance gate | No | **Yes** | No | Open |
| R-FLAKE | Intermittent `teams.spec.ts:58` under parallel load | Teams e2e signal | 2/261, desktop+isolated green | Low | Low | Re-diagnose (C6) | Maintenance | Recurs in CI | No | No | No | Open |
| R-AT | No hands-on screen-reader certification | Accessibility | Automated a11y only | Certain | Medium | Manual audit (C2) | QA | Acceptance gate | No | **Yes** | No | Open |
| R-LOAD | No production load/latency evidence | Capacity | Local 16c only | Certain | Medium | Prod load test (C4) | Ops | Pre-prod | No | Yes | **Yes** | Open |
| R-DEPLOY | No production deployment rehearsal | Deployment | Out of local scope | Certain | High | Rehearsal (C3) | Deployment | Pre-prod | No | Yes | **Yes** | Open |
| R-BACKUP | No backup/restore rehearsal | Data durability | Out of local scope | Certain | High | Rehearsal (C3) | Ops | Pre-prod | No | Yes | **Yes** | Open |
| R-PEN | No external penetration testing | Security | Local focused tests only | Medium | Medium | Pen test pre-prod | Security | Pre-prod | No | Deferred (accepted) | Advisory | Accepted |
| R-PROV | No live providers integrated | SMS/email/pay/analytics | Mock adapters only | Certain | N/A (fail-closed) | Gates fail-closed | Post-Phase-1 | Provider onboarding | No | Accepted fail-closed | No | Accepted |
| R-MONEY | Refund/payout/withdrawal/transfer disabled | Money-out | `TRANSFER_FEATURE_DISABLED` | Certain | N/A (fail-closed) | Zero prohibited effect (itests) | Post-Phase-1 | Feature launch | No | Accepted fail-closed | No | Accepted |
| R-SCHED | Operator-triggered jobs, no always-on scheduler | Ops automation | Bounded runner only | Certain | Low | Bounded caps; ops runs | Ops | Prod ops | No | Accepted | Advisory | Accepted |
| R-SEO | SSR/prerender + real wire 404 absent | SEO/crawl | SPA-only | Certain | Low | SPA meta/sitemap; accepted Phase-1 | Product | Post-Phase-1 | No | Deferred (accepted) | No | Accepted |
| R-INFRA | Deployment-owned TLS/observability/alert routing | Production ops | Out of local scope | Certain | High | Deployment rehearsal (C3) | Deployment | Pre-prod | No | Yes | **Yes** | Open |
| R-ARTIFACT | Test DBs (`dragon_e2e`,`dragon_migcheck`) left locally | Local dev env | 17b note | Certain | Negligible | Harmless; destructive-drop guardrail not bypassed | Dev | n/a | No | No | No | Accepted |
| R-CSP | `style-src 'unsafe-inline'` for Vue | Web CSP | DECISIONS.md 16b | Low | Low | Scripts never inline/eval | Security | Post-Phase-1 | No | No | Advisory | Accepted |
| R-SEARCH | Case-insensitive substring search scalability | Public search | 16c note | Low | Low | Bounded projections; revisit at scale | Product | Growth | No | No | No | Accepted |
| R-COMPAT | Older-app compatibility after latest migrations untested | Rollback safety | Forward-fix policy | Medium | Medium | Forward-fix only; no old-app rollback | Deployment | Rollback event | No | No | **Yes** | Open |
| R-RUNBOOK | Several ops runbooks documented-but-absent/unrehearsed | Incident response | RUNBOOKS.md gaps | Certain | Medium | Author+rehearse pre-prod | Ops | Prod incident | No | Yes | **Yes** | Open |

## Release blockers by scope

- **Local/test release candidate (`09b1af5`): None.** (Intermittent teams flake is non-blocking, tracked as C6/R-FLAKE.)
- **Staging:** C3 (deployment rehearsal), C6 recommended.
- **Production:** C3, C4, C5, plus R-COMPAT and R-RUNBOOK resolved.
- **Final Phase 1 acceptance:** C1 (362 rows), C2 (AT certification), C3, C4, C5, and `In progress` rows completed.

## Sign-off

- Selected decision: **GO WITH CONDITIONS** (local/test release candidate at `09b1af5`).
- Approved scope / excluded scope: as above (both nonempty).
- Verification summary: reused DRAGON-17b at `09b1af5` — closure 14/14; static clean; unit api 266/266 + web 39/39; integration 295/295; 22 migrations clean+idempotent; builds ok + bundle budget pass; focused security 55/55; focused perf/load 37/37+35/35; browser 258 pass / 1 intentional skip / 2 intermittent; `npm audit` 0 vulns.
- Unresolved evidence: 362 `Evidence pending`; manual AT; production deploy/backup/observability/load; live providers.
- Acceptance owner / approving role: **authorized human release owner — Awaiting authorized human sign-off.**
- Phase 1 status: **release candidate approved with conditions; not finally accepted.**
- DRAGON-17 status: **open** (final Phase 1 acceptance requires authorized human sign-off).
