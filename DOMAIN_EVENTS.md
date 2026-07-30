# Domain-event catalog

Every domain event the API publishes, its producer, its consumers, and its payload
fields — satisfying DOC-009 (catalog) and EVENT-012 (schemas and ownership).

This document describes what the code does today. Where a capability is absent it says so
rather than describing an intention.

## Envelope

One envelope for every event, defined in [apps/api/src/shared/events.ts](apps/api/src/shared/events.ts)
(`DomainEvent`), required by Requirements section 5.9:

| Field | Type | Notes |
|---|---|---|
| `eventId` | string | UUID; also the outbox record `_id`, which makes delivery idempotent |
| `eventName` | string | Dotted, `module.thing_happened`; see the catalog below |
| `eventVersion` | integer ≥ 1 | Validated at construction; a non-integer or `< 1` throws |
| `aggregateId` | string | The record the event is about |
| `occurredAt` | string | UTC ISO-8601 (DEC-005) |
| `producer` | string | Defaults to `dragon-api` (`DEFAULT_PRODUCER`, [unit-of-work.ts](apps/api/src/shared/db/unit-of-work.ts)); no caller currently overrides it |
| `correlationId` | string | Carried from the request; empty is rejected |
| `causationId` | string \| null | The event that caused this one; `null` when the cause was a request |
| `payload` | object | Per-event, listed below |

**Consumers MUST ignore unknown additive fields**, so the envelope and payloads only ever
grow. That rule is stated on the interface itself and is why no payload field below has ever
been removed or renamed — a breaking change requires a new `eventVersion`.

Every event currently in the system is `eventVersion: 1`. No second version exists yet, so
the version-negotiation path is declared but unexercised.

## Publication: transactional outbox

Events are never published directly. `uow.publish(...)` inside `runUnitOfWork` queues them,
and they are inserted into `domain_event_outbox` **in the same MongoDB transaction as the
state change that produced them** ([outbox.ts](apps/api/src/shared/db/outbox.ts),
[unit-of-work.ts](apps/api/src/shared/db/unit-of-work.ts)). Consequences, and the reason
Requirements section 32.1 makes the outbox mandatory:

- a committed state change can never lose its event;
- a rolled-back transaction never emits one;
- there is no "publish succeeded but the write failed" window.

Outbox records carry `state: 'pending' | 'dispatched' | 'failed'`, `attempts`, and
`lastError`. `readPendingEvents` is the generic read path, ordered by `event.occurredAt`.

## Consumers

**There is exactly one consumer today: the notifications module.** No other module reads the
outbox, and no external subscriber exists — there is no message broker, no webhook fan-out,
and no analytics consumer (see ANALYTICS-002, blocked on OD-026).

`NotificationsService.drain` ([service.ts](apps/api/src/modules/notifications/service.ts))
polls `state: 'pending'` oldest-first, maps the event through
`templateForEvent(eventName)` ([templates.ts](apps/api/src/modules/notifications/templates.ts)),
and marks the record `dispatched` in the same unit of work as the notification it created.
A unique `(accountId, sourceEventId, templateKey)` index makes a replayed or concurrent drain
idempotent.

**An event with no mapped template is dispatched and dropped.** That is deliberate — most
events exist for audit and future consumers, not for user-facing messages — but it means the
mapping table below is the complete list of events that currently *do* anything beyond being
recorded.

### Event → notification mapping (the full consumer contract)

| Event | Template key | Category | Recipient field | Channels | Payload fields used |
|---|---|---|---|---|---|
| `tournament.registration.approved` | `registration_approved` | transactional | `subjectId` | in_app, sms | `tournamentId` |
| `checkout.activated` | `registration_confirmed` | transactional | `accountId` | in_app, sms | `tournamentId` |
| `payment.purchase_succeeded` | `coins_added` | transactional | `accountId` | in_app | `dragonCoin` |
| `prize.entitlement_paid` | `prize_paid` | transactional | `accountId` | in_app | `tournamentId` |
| `stream.schedule_changed` | `stream_schedule_changed` | transactional | `accountId` | in_app, sms | `streamSlug`, `scheduledStartAt` |
| `course.completed` | `course_completed` | transactional | `accountId` | in_app | `courseSlug` |
| `social.mentioned` | `social_mentioned` | transactional | `accountId` | in_app | `postId`, `surface` |
| `competition.match_rescheduled` | `match_rescheduled` | transactional | `accountId` | in_app, sms | `tournamentId`, `matchId`, `scheduledAt`, `priorScheduledAt` |

`in_app` is always delivered. `sms` and `email` are consent- and gate-checked per delivery
(OD-008 / OD-003); a channel with no approved template or no contact address is recorded
`suppressed` with a reason rather than retried forever.

## Catalog

Producer paths are relative to `apps/api/src/`. Every event below is emitted through
`uow.publish` and therefore through the outbox.

### Identity

| Event | Producer | Payload | Consumed by |
|---|---|---|---|
| `account.registered` | `modules/identity/service.ts` | account identifiers | — |

### Tournament registration

Emitted as `tournament.registration.<state>`, where `<state>` is the registration's new
state ([registrations/service.ts](apps/api/src/modules/registrations/service.ts), `#publish`).
The state union is `REGISTRATION_STATES` in
[registrations/state.ts](apps/api/src/modules/registrations/state.ts):

`pending_payment`, `pending`, `approved`, `waitlisted`, `rejected`, `cancelled`

| Event | Producer | Payload | Consumed by |
|---|---|---|---|
| `tournament.registration.approved` | `modules/registrations/service.ts` | `tournamentId`, `subjectId`, `state` | notifications → `registration_approved` |
| `tournament.registration.pending_payment` | as above | as above | — |
| `tournament.registration.pending` | as above | as above | — |
| `tournament.registration.waitlisted` | as above | as above | — |
| `tournament.registration.rejected` | as above | as above | — |
| `tournament.registration.cancelled` | as above | as above | — |

Because the name is derived from the state, **adding a registration state adds an event
name**. A new state that needs a notification also needs a `templates.ts` entry.

### Competition

| Event | Producer | Consumed by |
|---|---|---|
| `competition.generated` | `modules/competitions/service.ts` | — |
| `competition.match_completed` | as above | — |
| `competition.result_corrected` | as above | — |
| `competition.lock_changed` | as above | — |
| `competition.swiss_round` | as above | — |
| `competition.regenerated` | as above | — |
| `competition.rolled_back` | as above | — |
| `competition.match_rescheduled` | as above | notifications → `match_rescheduled` |

`competition.match_rescheduled` is published **once per participant account**, not once per
match, because a template resolves exactly one `recipientField` per event — the same fan-out
`social.mentioned` uses. Its payload carries `accountId`, `tournamentId`, `matchId`,
`scheduledAt` and `priorScheduledAt`, and deliberately **not** the operator's reason, which is
staff-facing and may name another participant.

### Money: ledger, payments, holds, checkout, prizes, economy

| Event | Producer | Payload | Consumed by |
|---|---|---|---|
| `ledger.transaction_posted` | `modules/ledger/service.ts` | transaction identifiers | — |
| `payment.purchase_created` | `modules/payments/service.ts` | purchase identifiers | — |
| `payment.purchase_succeeded` | as above | includes `dragonCoin` | notifications → `coins_added` |
| `payment.purchase_corrected` | as above | correction identifiers | — |
| `hold.created` | `modules/holds/service.ts` | `ownerId`, `amount` | — |
| `hold.captured` | as above | `ownerId`, `amount` | — |
| `hold.<terminalReason>` | as above | `ownerId`, `amount` | — |
| `checkout.started` | `modules/checkout/service.ts` | `tournamentId`, `accountId` | — |
| `checkout.activated` | as above | `tournamentId`, `accountId` | notifications → `registration_confirmed` |
| `checkout.<terminal>` | as above | `tournamentId`, `accountId` | — |
| `prize.allocated` | `modules/prizes/service.ts` | allocation identifiers | — |
| `prize.entitlement_<action>` | as above | `tournamentId`, `accountId` | `prize.entitlement_paid` → `prize_paid` |
| `economy.transfer_completed` | `modules/economy/service.ts` | transfer identifiers | — |

`hold.<terminalReason>`, `checkout.<terminal>` and `prize.entitlement_<action>` are name
families built from the target state or action, exactly like the registration family. The
entitlement action set is `ENTITLEMENT_STATES` in
[prizes/state.ts](apps/api/src/modules/prizes/state.ts) plus `recipient_verified`.

### Education, streams, social, moderation

| Event | Producer | Payload | Consumed by |
|---|---|---|---|
| `course.completed` | `modules/education/service.ts` | `courseSlug` | notifications → `course_completed` |
| `stream.schedule_changed` | `modules/streams/service.ts` | `streamSlug`, `scheduledStartAt` | notifications → `stream_schedule_changed` |
| `social.mentioned` | `modules/social/service.ts` | `postId`, `surface` | notifications → `social_mentioned` |
| `moderation.report_filed` | `modules/moderation/service.ts` | report identifiers | — |

### Not product events

`account.created`, `a.b`, `test.ok` and `test.boom` appear in the source but only inside
test fixtures ([shared/db/foundation.itest.ts](apps/api/src/shared/db/foundation.itest.ts)
and the notifications unit tests). They are not emitted by any product path and must not be
subscribed to.

## Ownership

| Concern | Owner |
|---|---|
| The envelope and its validation | `shared/events.ts` |
| Transactional publication | `shared/db/unit-of-work.ts`, `shared/db/outbox.ts` |
| Each event's name, version and payload | the producing module named above |
| The event → notification mapping | `modules/notifications/templates.ts` |
| Delivery, consent and retry | `modules/notifications/service.ts` |

A module owns the events it produces: renaming one, or changing a payload field a consumer
reads, is that module's change and requires the mapping table above to be updated in the
same commit.

## Limitations

- **No event schema registry and no machine-readable event contract.** `GET /openapi.json`
  documents HTTP routes only. Payload shapes are TypeScript types at the producer, and this
  document is the human-readable contract. There is no runtime validation of a payload
  against a published schema.
- **One consumer.** Nothing outside the notifications module reads the outbox; there is no
  broker, no external subscriber, and no replay tool.
- **The dispatcher is a polled drain, not a daemon.** It runs when invoked; see
  [RUNBOOKS.md](RUNBOOKS.md) for how it is triggered.
- **No dead-letter surface beyond the record.** A failed event keeps `state: 'failed'`,
  `attempts` and `lastError` on the outbox row; there is no operator UI listing them.
