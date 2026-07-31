# Metric definitions

Every metric the platform calculates, where it is calculated, and exactly what it counts —
satisfying ANALYTICS-008 (metric definitions MUST be documented).

**Scope warning.** This document covers **operational counters and reconciliation figures**.
It is not a product-analytics or revenue-metric catalog, because none exists: no report covers
content, games, tournaments, registrations, matches or notifications (ANALYTICS-002), no
dashboard renders analytics data (ANALYTICS-009, PAGE-068), and no external analytics tracker
is integrated (OD-026). Those rows are blocked on the analytics-tool decision, not documented
away here.

## Rules every metric below obeys

1. **One calculation site.** Each metric is computed in exactly one place, named below. There
   is no second implementation and no cached copy, so a metric cannot disagree with itself.
2. **Computed on read, never precomputed.** Every figure is a live query. There is no
   materialized aggregate, no roll-up job, and therefore **no staleness**: freshness is
   "as of the moment the request was served". This is why ANALYTICS-009 (display data
   freshness) has nothing to display yet — there is no dashboard, and the underlying numbers
   have no lag to report.
3. **Bounded.** Every list-shaped query is paged with a clamped limit (`clampLimit`); every
   batch report caps its input array. No metric scans an unbounded collection (PERF-004).
4. **Authorization is server-side.** Each route below states its required permission.

## Operational metrics

`GET /api/v1/admin/ops/metrics` → `OperationsService.metrics()`
([apps/api/src/modules/operations/service.ts](apps/api/src/modules/operations/service.ts)).
Requires the operations permission (`opsGate`). Returns a flat object of four integers.

| Metric | Definition | Exact query | Healthy value |
|---|---|---|---|
| `pendingOutbox` | Domain events written but not yet dispatched to a consumer | `domain_event_outbox` where `state = 'pending'` | Near zero. A rising value means the notifications drain is not running |
| `deadLetterDeliveries` | Notification deliveries that exhausted every retry | `notification_deliveries` where `status = 'dead'` | Zero. Non-zero means messages were permanently lost |
| `failedJobs` | Background job executions that ended in failure | `job_executions` where `status = 'failed'` | Zero. Index-served by `jobs_state_createdAt` |
| `openAlerts` | Operator alerts raised and not yet acknowledged | `ops_alerts` where `status = 'open'` | Zero |

All four are **lifetime totals, not rates and not windowed**. There is no time bucket, so
`failedJobs` counts every failure since the database was created. Treat them as backlog
gauges, not throughput.

### The health check that produces alerts

`POST /api/v1/admin/ops/health-check` → `checkHealth()` inspects the same failure signals
(MongoDB reachability, the dead-letter queue, failed jobs) and **raises alerts** as a side
effect. It is the only writer of `ops_alerts` from a signal; `raiseAlert` bounds the message to
300 characters and the detail object to primitive values.

`openAlerts` is therefore a **derived** figure: it counts what a health check previously
decided was worth an operator's attention, not an independent measurement.

## Liveness and readiness

Not metrics, but frequently mistaken for them:

| Endpoint | Meaning |
|---|---|
| `GET /health` | **Liveness only** — process viability, no dependency calls (section 28.4). Answers 200 even when MongoDB is down |
| `GET /health/ready` | **Readiness** — pings MongoDB and returns 200 `ready` or 503 `not_ready` |

Neither is a public status page. `/status` (PAGE-025) does not exist.

## Registration counts

`POST /api/v1/admin/registration-counts` → `RegistrationsService.countsByState(tournamentIds)`.
Requires `tournamentManage`. Body caps at **50 tournament ids**.

Returns, per tournament, a count per `RegistrationState`: `pending_payment`, `pending`,
`approved`, `waitlisted`, `rejected`, `cancelled`.

**Only `approved` occupies a capacity seat.** `waitlisted` holds an ordered queue position and
`rejected`/`cancelled` are terminal and inactive, so "registrations" is never a single number —
reading the total as demand overstates filled seats.

Seat occupancy shown on the organizer surfaces is derived from the `approved` count against
tournament capacity, calculated in the registrations module.

## Reconciliation figures

These are **difference reports**, not KPIs. Each is read-only, finance-permission gated, and
names every discrepancy rather than returning a score. Definitions live with the code; see
[FINANCIAL_GUIDE.md](FINANCIAL_GUIDE.md).

| Report | Route | What it compares |
|---|---|---|
| Holds | `POST /admin/holds/reconciliation` | Holds against ledger accounts (≤100 account ids per call) |

A report returning no differences means the two sides agree at read time; it is not a
statement about a period.

## Analytics event collection (not a metric source yet)

`POST /api/v1/analytics/events` records a **consent-aware** event into the internal sink:

- the caller must be authenticated; the event carries `name`, `consented`, and bounded `props`;
- **client-emitted events are always treated as non-essential and require consent**;
- the account is **pseudonymized** with `sha256(salt + ':' + accountId)` truncated to 32 hex
  characters, where the salt is `ANALYTICS_PSEUDONYM_SALT` — a production-required config
  secret, never a source constant, so this repository cannot be used to de-pseudonymize a
  production sink;
- string props are truncated to 200 characters; only strings, numbers and booleans survive;
- error text is redacted to a single line with control characters stripped and a 300-character
  cap, so **no stack trace or secret can enter the sink**.

**Nothing is ever forwarded externally.** `EXTERNAL_TRACKER_INTEGRATED = false` is a source
constant, and forwarding requires both the OD-026 gate *and* an integrated tracker — the latter
is never true, so the gate's state is irrelevant. No report reads this collection.

## What is deliberately not measured

| Absent | Why |
|---|---|
| Product analytics: content, games, tournaments, registrations, matches, notifications reports | ANALYTICS-002 — blocked on OD-026 |
| Any dashboard, with or without a freshness indicator | ANALYTICS-009, PAGE-068 — blocked on OD-026 |
| Revenue analytics | Requires the analytics decision and a live payment provider; neither exists |
| Request-rate, latency, error-rate telemetry | No production instrumentation; PERF-001/002/003 remain blocked on OD-023 |
| Staff last-use of a role grant | Not recorded anywhere (ADMIN-011) |

Do not add a metric to this document before it has exactly one calculation site in the code.
